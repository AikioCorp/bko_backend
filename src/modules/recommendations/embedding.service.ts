import crypto from "crypto";
import { prisma } from "../../config/prisma.js";

export interface EmbeddingResult {
  vector: number[];
  provider: string;
  model: string;
  dimensions: number;
  modelVersion: string;
}

export class EmbeddingService {
  private static readonly DIMENSIONS = 1024;
  private static readonly MODEL_VERSION = "v1";

  private static pgVectorChecked: boolean | null = null;

  /**
   * Vérifie si l'extension pgvector est installée et utilisable dans la base PostgreSQL courante
   */
  static async isPgVectorAvailable(): Promise<boolean> {
    if (this.pgVectorChecked !== null) return this.pgVectorChecked;
    try {
      const res = await prisma.$queryRawUnsafe<any[]>(
        "SELECT 1 FROM pg_extension WHERE extname = 'vector'"
      );
      this.pgVectorChecked = Array.isArray(res) && res.length > 0;
    } catch {
      this.pgVectorChecked = false;
    }
    return this.pgVectorChecked;
  }

  /**
   * Calcule un hash SHA-256 stable du texte source
   */
  static computeContentHash(text: string): string {
    return crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex");
  }

  /**
   * Génère un vecteur dense avec traçabilité stricte du fournisseur réel :
   * - Si BGE_M3_API_URL / EMBEDDING_API_URL est configuré et disponible : provider="bge-m3", model="BAAI/bge-m3"
   * - Sinon, repli lexical certifié : provider="lexical-hash", model="ngram-hash-v1"
   * Aucun vecteur de repli n'est frauduleusement labellisé sous le modèle BGE-M3.
   */
  static async generateEmbedding(text: string): Promise<EmbeddingResult> {
    const providerMode = (process.env.EMBEDDING_PROVIDER || "local").trim().toLowerCase();

    // Mode externe optionnel : uniquement si EMBEDDING_PROVIDER est explicitement configuré sur 'remote'
    if (providerMode === "remote") {
      const apiUrl = process.env.BGE_M3_API_URL || process.env.EMBEDDING_API_URL;
      if (apiUrl) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000); // Max 5s timeout

          const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(process.env.EMBEDDING_API_KEY ? { Authorization: `Bearer ${process.env.EMBEDDING_API_KEY}` } : {}),
            },
            body: JSON.stringify({
              model: "BAAI/bge-m3",
              input: text.slice(0, 4000),
            }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            const json = await response.json();
            const vec = json?.data?.[0]?.embedding || json?.embedding;
            if (Array.isArray(vec) && vec.length === this.DIMENSIONS) {
              const normalized = this.normalizeVector(vec);
              return {
                vector: normalized,
                provider: "bge-m3",
                model: "BAAI/bge-m3",
                dimensions: this.DIMENSIONS,
                modelVersion: this.MODEL_VERSION,
              };
            }
          }
        } catch (err: any) {
          console.warn("[EmbeddingService] Échec appel BGE-M3 externe (" + (err.message || "timeout") + "), passage au repli lexical certifié.");
        }
      }
    }

    // Repli lexical déterministe certifié et explicitement identifié
    const lexicalVec = this.createDeterministicEmbedding(text, this.DIMENSIONS);
    return {
      vector: lexicalVec,
      provider: "lexical-hash",
      model: "ngram-hash-v1",
      dimensions: this.DIMENSIONS,
      modelVersion: this.MODEL_VERSION,
    };
  }

  /**
   * Normalisation euclidienne L2 du vecteur avec validation stricte des valeurs finies
   */
  static normalizeVector(vec: number[]): number[] {
    if (!Array.isArray(vec) || vec.length === 0) {
      throw new Error("Vecteur invalide ou vide");
    }

    let sumSq = 0;
    for (let i = 0; i < vec.length; i++) {
      const val = vec[i];
      if (typeof val !== "number" || !Number.isFinite(val)) {
        throw new Error(`Valeur de vecteur non finie détectée à l'index ${i}: ${val}`);
      }
      sumSq += val * val;
    }

    const norm = Math.sqrt(sumSq);
    if (norm <= 1e-12) {
      throw new Error("Norme euclidienne nulle ou quasi-nulle");
    }

    return vec.map((v) => v / norm);
  }

  /**
   * Calcul de similarité cosinus entre deux vecteurs de même dimension
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    const sim = dot / denominator;
    return Math.max(0, Math.min(1, (sim + 1) / 2)); // Ramené sur 0..1
  }

  /**
   * Génération déterministe par hachage de traits n-gram multilingues (supporte FR, Bambara, etc.)
   */
  private static createDeterministicEmbedding(text: string, dimensions: number): number[] {
    const vector = new Array(dimensions).fill(0);
    const cleaned = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const words = cleaned.split(/[\s,.;:!?\-'"()]+/g).filter(Boolean);

    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      const h1 = this.hashString(word);
      const idx1 = Math.abs(h1) % dimensions;
      const sign1 = h1 % 2 === 0 ? 1 : -1;
      vector[idx1] += sign1 * 1.5;

      // Sous-mots (trigrammes pour capter les racines et morphologie mandingue / bambara)
      for (let i = 0; i < word.length - 2; i++) {
        const tri = word.slice(i, i + 3);
        const h2 = this.hashString(tri);
        const idx2 = Math.abs(h2) % dimensions;
        const sign2 = h2 % 2 === 0 ? 0.8 : -0.8;
        vector[idx2] += sign2;
      }
    }

    return this.normalizeVector(vector);
  }

  private static hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  /**
   * Calcul ou mise à jour de l'embedding d'un épisode
   */
  static async computeEpisodeEmbedding(episodeId: string): Promise<boolean> {
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      include: {
        podcast: true,
        topics: { include: { topic: true } },
        transcripts: {
          where: { isPrimary: true, status: "READY" },
          take: 1,
          include: { segments: { take: 10, orderBy: { position: "asc" } } },
        },
      },
    });

    if (!episode) return false;

    // Métadonnées publiques textuelles combinées
    const transcriptText = episode.transcripts[0]?.segments?.map((s) => s.text).join(" ") || "";
    const topicText = episode.topics.map((t) => t.topic.name).join(" ");
    const fullText = `${episode.title}. ${episode.description || ""}. ${episode.summary || ""}. Thèmes: ${topicText}. Émission: ${episode.podcast?.name || ""}. ${transcriptText}`.trim();

    const contentHash = this.computeContentHash(fullText);

    // Vérifier si déjà calculé avec la même version et le même hash
    const existing = await prisma.episodeEmbedding.findUnique({ where: { episodeId } });
    if (existing && existing.contentHash === contentHash && existing.modelVersion === this.MODEL_VERSION && existing.status === "COMPLETED") {
      await prisma.episodeEmbedding.update({
        where: { episodeId },
        data: { updatedAt: new Date() },
      });
      return true;
    }

    try {
      const generated = await this.generateEmbedding(fullText);
      await prisma.episodeEmbedding.upsert({
        where: { episodeId },
        update: {
          provider: generated.provider,
          model: generated.model,
          dimensions: generated.dimensions,
          modelVersion: generated.modelVersion,
          contentHash,
          vector: generated.vector,
          status: "COMPLETED",
          errorReason: null,
          updatedAt: new Date(),
        },
        create: {
          episodeId,
          provider: generated.provider,
          model: generated.model,
          dimensions: generated.dimensions,
          modelVersion: generated.modelVersion,
          contentHash,
          vector: generated.vector,
          status: "COMPLETED",
        },
      });
      return true;
    } catch (err: any) {
      await prisma.episodeEmbedding.upsert({
        where: { episodeId },
        update: {
          status: "FAILED",
          errorReason: err.message || "Failed to compute embedding",
          retryCount: { increment: 1 },
          updatedAt: new Date(),
        },
        create: {
          episodeId,
          contentHash,
          vector: [],
          status: "FAILED",
          errorReason: err.message,
          retryCount: 1,
        },
      });
      return false;
    }
  }

  /**
   * Calcul ou mise à jour de l'embedding d'un podcast
   */
  static async computePodcastEmbedding(podcastId: string): Promise<boolean> {
    const podcast = await prisma.podcast.findUnique({
      where: { id: podcastId },
      include: {
        categories: { include: { category: true } },
        topics: { include: { topic: true } },
      },
    });

    if (!podcast) return false;

    const catText = podcast.categories.map((c) => c.category.name).join(" ");
    const topText = podcast.topics.map((t) => t.topic.name).join(" ");
    const fullText = `${podcast.name}. ${podcast.description || ""}. ${podcast.shortDescription || ""}. Catégories: ${catText}. Thèmes: ${topText}`.trim();

    const contentHash = this.computeContentHash(fullText);

    const existing = await prisma.podcastEmbedding.findUnique({ where: { podcastId } });
    if (existing && existing.contentHash === contentHash && existing.modelVersion === this.MODEL_VERSION && existing.status === "COMPLETED") {
      await prisma.podcastEmbedding.update({
        where: { podcastId },
        data: { updatedAt: new Date() },
      });
      return true;
    }

    try {
      const generated = await this.generateEmbedding(fullText);
      await prisma.podcastEmbedding.upsert({
        where: { podcastId },
        update: {
          provider: generated.provider,
          model: generated.model,
          dimensions: generated.dimensions,
          modelVersion: generated.modelVersion,
          contentHash,
          vector: generated.vector,
          status: "COMPLETED",
          errorReason: null,
          updatedAt: new Date(),
        },
        create: {
          podcastId,
          provider: generated.provider,
          model: generated.model,
          dimensions: generated.dimensions,
          modelVersion: generated.modelVersion,
          contentHash,
          vector: generated.vector,
          status: "COMPLETED",
        },
      });
      return true;
    } catch (err: any) {
      await prisma.podcastEmbedding.upsert({
        where: { podcastId },
        update: {
          status: "FAILED",
          errorReason: err.message || "Failed to compute embedding",
          retryCount: { increment: 1 },
          updatedAt: new Date(),
        },
        create: {
          podcastId,
          contentHash,
          vector: [],
          status: "FAILED",
          errorReason: err.message,
          retryCount: 1,
        },
      });
      return false;
    }
  }

  /**
   * Trouve les épisodes les plus similaires sémantiquement.
   * Utilise pgvector natif si disponible dans PostgreSQL, avec repli en mémoire sécurisé.
   * Isole strictement les espaces vectoriels : aucune comparaison entre modèles incompatibles.
   */
  static async findSimilarEpisodes(
    episodeId: string,
    limit = 10
  ): Promise<Array<{ episodeId: string; similarity: number }>> {
    const target = await prisma.episodeEmbedding.findUnique({ where: { episodeId } });
    if (!target || !target.vector || target.vector.length === 0 || target.status !== "COMPLETED") {
      return [];
    }

    const hasPgVector = await this.isPgVectorAvailable();
    if (hasPgVector) {
      try {
        const formattedVector = `[${target.vector.join(",")}]`;
        const results = await prisma.$queryRawUnsafe<Array<{ episodeId: string; distance: number }>>(
          `SELECT ee."episodeId", (ee.vector::vector <=> $1::vector) as distance
           FROM "EpisodeEmbedding" ee
           JOIN "Episode" e ON ee."episodeId" = e.id
           JOIN "Podcast" p ON e."podcastId" = p.id
           WHERE ee."episodeId" != $2
             AND ee.status = 'COMPLETED'
             AND ee.provider = $3
             AND ee.model = $4
             AND ee.dimensions = $5
             AND ee."modelVersion" = $6
             AND e.status = 'PUBLISHED'
             AND p.status = 'PUBLISHED'
           ORDER BY distance ASC
           LIMIT $7`,
          formattedVector,
          episodeId,
          target.provider,
          target.model,
          target.dimensions,
          target.modelVersion,
          limit
        );

        return results.map((r) => ({
          episodeId: r.episodeId,
          similarity: Math.max(0, Math.min(1, 1 - r.distance / 2)),
        }));
      } catch (e) {
        console.warn("[EmbeddingService] pgvector query failed, falling back to app ranking:", e);
      }
    }

    // Repli en mémoire : comparaison STRICTEMENT restreinte au même provider, model, dimensions, modelVersion
    const candidates = await prisma.episodeEmbedding.findMany({
      where: {
        episodeId: { not: episodeId },
        status: "COMPLETED",
        provider: target.provider,
        model: target.model,
        dimensions: target.dimensions,
        modelVersion: target.modelVersion,
        episode: { status: "PUBLISHED", podcast: { status: "PUBLISHED" } },
      },
      select: { episodeId: true, vector: true },
    });

    const scored = candidates.map((c) => ({
      episodeId: c.episodeId,
      similarity: this.cosineSimilarity(target.vector, c.vector),
    }));

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  }

  /**
   * Trouve les podcasts les plus similaires sémantiquement.
   * Utilise pgvector natif si disponible dans PostgreSQL, avec repli en mémoire sécurisé.
   * Isole strictement les espaces vectoriels : aucune comparaison entre modèles incompatibles.
   */
  static async findSimilarPodcasts(
    podcastId: string,
    limit = 10
  ): Promise<Array<{ podcastId: string; similarity: number }>> {
    const target = await prisma.podcastEmbedding.findUnique({ where: { podcastId } });
    if (!target || !target.vector || target.vector.length === 0 || target.status !== "COMPLETED") {
      return [];
    }

    const hasPgVector = await this.isPgVectorAvailable();
    if (hasPgVector) {
      try {
        const formattedVector = `[${target.vector.join(",")}]`;
        const results = await prisma.$queryRawUnsafe<Array<{ podcastId: string; distance: number }>>(
          `SELECT pe."podcastId", (pe.vector::vector <=> $1::vector) as distance
           FROM "PodcastEmbedding" pe
           JOIN "Podcast" p ON pe."podcastId" = p.id
           WHERE pe."podcastId" != $2
             AND pe.status = 'COMPLETED'
             AND pe.provider = $3
             AND pe.model = $4
             AND pe.dimensions = $5
             AND pe."modelVersion" = $6
             AND p.status = 'PUBLISHED'
           ORDER BY distance ASC
           LIMIT $7`,
          formattedVector,
          podcastId,
          target.provider,
          target.model,
          target.dimensions,
          target.modelVersion,
          limit
        );

        return results.map((r) => ({
          podcastId: r.podcastId,
          similarity: Math.max(0, Math.min(1, 1 - r.distance / 2)),
        }));
      } catch (e) {
        console.warn("[EmbeddingService] pgvector query failed for podcasts, falling back to app ranking:", e);
      }
    }

    // Repli en mémoire avec compatibilité stricte des dimensions et modèles
    const candidates = await prisma.podcastEmbedding.findMany({
      where: {
        podcastId: { not: podcastId },
        status: "COMPLETED",
        provider: target.provider,
        model: target.model,
        dimensions: target.dimensions,
        modelVersion: target.modelVersion,
        podcast: { status: "PUBLISHED" },
      },
      select: { podcastId: true, vector: true },
    });

    const scored = candidates.map((c) => ({
      podcastId: c.podcastId,
      similarity: this.cosineSimilarity(target.vector, c.vector),
    }));

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  }
}
