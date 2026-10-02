import { prisma } from "../../config/prisma.js";
import { parseWebStream } from "music-metadata";
import { NotificationService } from "../../services/notification.service.js";
import { StorageFactory } from "../../services/storage/storage.factory.js";

export class MediaWorkerService {
  static async processNextJob(): Promise<boolean> {
    const job = await prisma.$transaction(async (tx) => {
      const pending = await tx.jobQueueItem.findFirst({
        where: {
          status: "PENDING",
          queueName: "media-processing",
          runAt: { lte: new Date() },
        },
        orderBy: { runAt: "asc" },
      });

      if (!pending) return null;

      return tx.jobQueueItem.update({
        where: { id: pending.id },
        data: {
          status: "PROCESSING",
          lockedAt: new Date(),
          lockedBy: "worker-1",
          attempts: { increment: 1 },
        },
      });
    });

    if (!job) return false;

    try {
      const payload = job.payload as any;
      if (job.jobType === "MEDIA_ANALYZE") {
        await this.handleMediaAnalyze(payload);
      }

      await prisma.jobQueueItem.update({
        where: { id: job.id },
        data: { status: "COMPLETED" },
      });
    } catch (error: any) {
      // Dernière tentative épuisée : le fichier est marqué en échec (visible par le créateur et l'admin).
      if (job.attempts >= job.maxAttempts) {
        const assetId = (job.payload as any)?.mediaAssetId;
        if (assetId) {
          const asset = await prisma.mediaAsset.update({ where: { id: assetId }, data: { status: "FAILED" } }).catch(() => null);
          if (asset) {
            const episodeId = (job.payload as any)?.episodeId as string | undefined;
            await NotificationService.notify(
              [asset.ownerId],
              {
                type: "MEDIA_FAILED",
                title: "Le traitement de votre fichier a échoué",
                body: "Le fichier n'a pas pu être analysé (format illisible ou corrompu). Renvoyez-le depuis l'épisode.",
                link: episodeId ? `/studio/episodes/${episodeId}/edit` : "/studio",
              },
              { email: true }
            );
          }
        }
      }
      await prisma.jobQueueItem.update({
        where: { id: job.id },
        data: {
          status: job.attempts >= job.maxAttempts ? "FAILED" : "PENDING",
          lastError: error.message || "Erreur lors du traitement média",
        },
      });
    }

    return true;
  }

  private static async handleMediaAnalyze(payload: { mediaAssetId: string; episodeId?: string; mediaType: "AUDIO" | "VIDEO" }) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id: payload.mediaAssetId } });
    if (!asset) return;

    const storage = StorageFactory.getProvider();
    const publicUrl = await storage.createPresignedDownloadUrl(asset.key);

    // Extraction des métadonnées réelles (durée, codec, débit) depuis le fichier stocké.
    // En stockage local/mock (aucun octet réellement stocké), on ne fabrique PAS de valeurs :
    // la durée reste inconnue plutôt qu'inventée.
    const meta = await this.probe(publicUrl, asset.mimeType, Number(asset.sizeBytes));
    const durationSeconds = meta?.durationSeconds ?? null;

    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        status: "READY",
        durationSeconds,
        codec: meta?.codec ?? null,
        bitrateKbps: meta?.bitrateKbps ?? null,
        sampleRateHz: meta?.sampleRateHz ?? null,
        channels: meta?.channels ?? null,
      },
    });

    // 2. Si l'épisode est renseigné, créer la MediaSource NATIVE hébergée
    if (payload.episodeId) {
      const isAudio = payload.mediaType === "AUDIO";
      const isVideo = payload.mediaType === "VIDEO";

      // Idempotence : un rejeu du job (après échec partiel) ne duplique pas la source.
      const already = await prisma.mediaSource.findFirst({ where: { episodeId: payload.episodeId, mediaAssetId: asset.id } });
      if (!already) await prisma.mediaSource.create({
        data: {
          episodeId: payload.episodeId,
          type: payload.mediaType,
          sourceType: "UPLOAD",
          playbackMode: "NATIVE",
          mediaAssetId: asset.id,
          externalUrl: publicUrl,
          durationSeconds: durationSeconds ?? undefined,
          mimeType: asset.mimeType,
          isPrimaryAudio: isAudio,
          isPrimaryVideo: isVideo,
        },
      });

      // Mettre à jour la durée de l'épisode (seulement si elle est réellement connue)
      if (durationSeconds) {
        await prisma.episode.update({
          where: { id: payload.episodeId },
          data: { durationSeconds },
        });
      }
    }
  }

  /** Lit les métadonnées audio/vidéo du fichier ; null si le stockage ne contient pas d'octets réels (mode local). */
  private static async probe(url: string, mimeType: string, size: number) {
    const realStorage = Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok || !res.body) throw new Error(`Lecture du fichier impossible (HTTP ${res.status})`);
      const parsed = await parseWebStream(res.body as any, { mimeType, size }, { duration: true });
      const f = parsed.format;
      return {
        durationSeconds: f.duration ? Math.round(f.duration) : null,
        codec: f.codec ?? null,
        bitrateKbps: f.bitrate ? Math.round(f.bitrate / 1000) : null,
        sampleRateHz: f.sampleRate ?? null,
        channels: f.numberOfChannels ?? null,
      };
    } catch (e: any) {
      // Stockage réel : un fichier illisible/corrompu doit échouer (visible côté admin et créateur).
      if (realStorage) throw new Error(`Analyse du média impossible : ${e.message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
