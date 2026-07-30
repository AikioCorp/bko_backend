import { prisma } from "../../config/prisma.js";
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

    // Extraction / Simulation des métadonnées FFprobe
    const durationSeconds = payload.mediaType === "AUDIO" ? 1800 : 2700; // 30 mins audio, 45 mins vidéo
    const width = payload.mediaType === "VIDEO" ? 1920 : null;
    const height = payload.mediaType === "VIDEO" ? 1080 : null;
    const codec = payload.mediaType === "AUDIO" ? "aac" : "h264";

    // 1. Mettre à jour le MediaAsset en statut READY
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        status: "READY",
        durationSeconds,
        width,
        height,
        codec,
        bitrateKbps: 192,
      },
    });

    // 2. Si l'épisode est renseigné, créer la MediaSource NATIVE hébergée
    if (payload.episodeId) {
      const isAudio = payload.mediaType === "AUDIO";
      const isVideo = payload.mediaType === "VIDEO";

      await prisma.mediaSource.create({
        data: {
          episodeId: payload.episodeId,
          type: payload.mediaType,
          sourceType: "UPLOAD",
          playbackMode: "NATIVE",
          mediaAssetId: asset.id,
          externalUrl: publicUrl,
          durationSeconds,
          isPrimaryAudio: isAudio,
          isPrimaryVideo: isVideo,
        },
      });

      // Mettre à jour la durée de l'épisode
      await prisma.episode.update({
        where: { id: payload.episodeId },
        data: { durationSeconds },
      });
    }
  }
}
