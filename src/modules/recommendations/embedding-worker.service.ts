import { prisma } from "../../config/prisma.js";
import { EmbeddingService } from "./embedding.service.js";

export class EmbeddingWorkerService {
  /**
   * Traite équitablement les émissions (podcasts) et les épisodes publiés ou modifiés sans embeddings valides.
   * Évite de boucler continuellement sur le même élément en vérifiant e.updatedAt > ee.updatedAt et en ordonnançant par ancienneté.
   */
  static async processPendingEmbeddings(): Promise<boolean> {
    try {
      const backoffDelay = new Date(Date.now() - 60 * 1000); // 1 minute de délai avant retry
      let processedAny = false;

      // 1. Traitement d'une émission (podcast) en attente
      const pendingPodcast = await this.findPendingPodcast(backoffDelay);
      if (pendingPodcast) {
        const ok = await EmbeddingService.computePodcastEmbedding(pendingPodcast.id);
        if (ok) processedAny = true;
      }

      // 2. Traitement d'un épisode en attente
      const pendingEpisode = await this.findPendingEpisode(backoffDelay);
      if (pendingEpisode) {
        const ok = await EmbeddingService.computeEpisodeEmbedding(pendingEpisode.id);
        if (ok) processedAny = true;
      }

      return processedAny;
    } catch (err) {
      console.error("[EmbeddingWorkerService] Erreur lors du calcul d'embedding:", err);
      return false;
    }
  }

  /**
   * Recherche le prochain épisode nécessitant un calcul d'embedding :
   * - Aucun embedding existant
   * - Échec avec retryCount < 3 et backoff écoulé
   * - Épisode modifié après la date du dernier calcul d'embedding (e.updatedAt > ee.updatedAt)
   */
  private static async findPendingEpisode(backoffDelay: Date): Promise<{ id: string } | null> {
    const results = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT e.id
      FROM "Episode" e
      LEFT JOIN "EpisodeEmbedding" ee ON e.id = ee."episodeId"
      WHERE e.status = 'PUBLISHED'
        AND (
          ee.id IS NULL
          OR (ee.status = 'FAILED' AND ee."retryCount" < 3 AND ee."updatedAt" < ${backoffDelay})
          OR (ee.status = 'COMPLETED' AND e."updatedAt" > ee."updatedAt" AND ee."updatedAt" < ${backoffDelay})
        )
      ORDER BY
        CASE WHEN ee.id IS NULL THEN 0 ELSE 1 END ASC,
        COALESCE(ee."updatedAt", '1970-01-01'::timestamp) ASC
      LIMIT 1;
    `;
    return results[0] || null;
  }

  /**
   * Recherche la prochaine émission (podcast) nécessitant un calcul d'embedding :
   * - Aucun embedding existant
   * - Échec avec retryCount < 3 et backoff écoulé
   * - Émission modifiée après la date du dernier calcul d'embedding (p.updatedAt > pe.updatedAt)
   */
  private static async findPendingPodcast(backoffDelay: Date): Promise<{ id: string } | null> {
    const results = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT p.id
      FROM "Podcast" p
      LEFT JOIN "PodcastEmbedding" pe ON p.id = pe."podcastId"
      WHERE p.status = 'PUBLISHED'
        AND (
          pe.id IS NULL
          OR (pe.status = 'FAILED' AND pe."retryCount" < 3 AND pe."updatedAt" < ${backoffDelay})
          OR (pe.status = 'COMPLETED' AND p."updatedAt" > pe."updatedAt" AND pe."updatedAt" < ${backoffDelay})
        )
      ORDER BY
        CASE WHEN pe.id IS NULL THEN 0 ELSE 1 END ASC,
        COALESCE(pe."updatedAt", '1970-01-01'::timestamp) ASC
      LIMIT 1;
    `;
    return results[0] || null;
  }
}
