import { prisma } from "../../config/prisma.js";
import { StorageFactory } from "../../services/storage/storage.factory.js";
import { MarketAccessService } from "../../services/market-access.service.js";
import { MediaType } from "@prisma/client";

const CREATOR_QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 Go par créateur

const MAX_AUDIO_BYTES = 250 * 1024 * 1024; // 250 Mo
const MAX_VIDEO_BYTES = 2000 * 1024 * 1024; // 2 Go

const ALLOWED_AUDIO_MIMES = ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav"];
const ALLOWED_VIDEO_MIMES = ["video/mp4", "video/quicktime"];

// L'extension de la clé de stockage est déduite du MIME validé, jamais du nom client.
const EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

export class UploadService {
  static async createUploadSession(
    userId: string,
    params: {
      originalFilename: string;
      mimeType: string;
      sizeBytes: number;
      mediaType: MediaType;
      episodeId?: string;
    }
  ) {
    const { originalFilename, mimeType, sizeBytes, mediaType, episodeId } = params;

    // 0. Contexte marché + propriété.
    //    - Si l'upload cible un épisode : l'utilisateur doit être membre (hors ANALYST)
    //      du podcast de cet épisode (protection IDOR), et le marché de référence est
    //      le pays de ce podcast.
    //    - Sinon : le marché de référence est le pays du profil créateur.
    const creatorProfile = await prisma.creatorProfile.findUnique({ where: { userId } });
    let countryCode = creatorProfile?.countryId ?? null;

    if (episodeId) {
      const episode = await prisma.episode.findUnique({
        where: { id: episodeId },
        include: { podcast: { select: { id: true, countryId: true } } },
      });
      if (!episode) {
        throw new Error("EPISODE_NOT_FOUND");
      }
      const member = await prisma.podcastMember.findUnique({
        where: { podcastId_userId: { podcastId: episode.podcast.id, userId } },
      });
      if (!member || member.role === "ANALYST") {
        throw new Error("FORBIDDEN");
      }
      countryCode = episode.podcast.countryId;
    }

    if (!countryCode) {
      // Sans contexte marché, on ne peut pas évaluer les capacités : refus par défaut.
      throw new Error("MARKET_UPLOAD_DISABLED");
    }

    const canUpload = await MarketAccessService.canUpload(countryCode, creatorProfile?.id);
    if (!canUpload) {
      throw new Error("MARKET_UPLOAD_DISABLED");
    }

    // 1. Validation du MIME Type
    const isAudio = mediaType === "AUDIO" && ALLOWED_AUDIO_MIMES.includes(mimeType);
    const isVideo = mediaType === "VIDEO" && ALLOWED_VIDEO_MIMES.includes(mimeType);

    if (!isAudio && !isVideo) {
      throw new Error("INVALID_MEDIA_TYPE");
    }

    // 2. Validation des limites de taille
    if (mediaType === "AUDIO" && sizeBytes > MAX_AUDIO_BYTES) {
      throw new Error("FILE_TOO_LARGE_AUDIO");
    }
    if (mediaType === "VIDEO" && sizeBytes > MAX_VIDEO_BYTES) {
      throw new Error("FILE_TOO_LARGE_VIDEO");
    }

    // 3. Calcul du stockage utilisé & quota (Max 10 Go par créateur)
    const usage = await prisma.mediaAsset.aggregate({
      where: { ownerId: userId, status: { not: "DELETED" } },
      _sum: { sizeBytes: true },
    });
    const totalUsed = Number(usage._sum.sizeBytes || 0);
    if (totalUsed + sizeBytes > CREATOR_QUOTA_BYTES) {
      throw new Error("QUOTA_EXCEEDED");
    }

    // 4. Génération de la Clé Objet S3 Structurée
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const assetId = `asset_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const ext = EXT_BY_MIME[mimeType] ?? (mediaType === "AUDIO" ? "mp3" : "mp4");
    const storageKey = `media/${userId}/${year}/${month}/${assetId}/original.${ext}`;

    const storage = StorageFactory.getProvider();
    const presigned = await storage.createPresignedUploadUrl(storageKey, mimeType, 3600);

    // 5. Créer la session en base
    const uploadSession = await prisma.uploadSession.create({
      data: {
        userId,
        episodeId,
        mediaType,
        originalFilename,
        mimeType,
        sizeBytes: BigInt(sizeBytes),
        storageKey,
        status: "UPLOADING",
        expiresAt: presigned.expiresAt,
      },
    });

    return {
      uploadSessionId: uploadSession.id,
      uploadUrl: presigned.uploadUrl,
      storageKey,
      expiresAt: presigned.expiresAt,
    };
  }

  static async completeUploadSession(userId: string, uploadSessionId: string) {
    const session = await prisma.uploadSession.findUnique({
      where: { id: uploadSessionId },
    });

    if (!session || session.userId !== userId) {
      throw new Error("SESSION_NOT_FOUND");
    }

    // Idempotence : une session déjà complétée ne recrée ni asset ni job.
    if (session.status === "COMPLETED" && session.mediaAssetId) {
      return {
        mediaAssetId: session.mediaAssetId,
        status: "PROCESSING",
        message: "Upload déjà complété.",
      };
    }
    if (session.status !== "UPLOADING") {
      throw new Error("SESSION_NOT_FOUND");
    }

    const storage = StorageFactory.getProvider();
    const exists = await storage.objectExists(session.storageKey);
    if (!exists) {
      await prisma.uploadSession.update({
        where: { id: uploadSessionId },
        data: { status: "FAILED" },
      });
      throw new Error("OBJECT_NOT_FOUND_IN_STORAGE");
    }

    // Réconciliation de la taille RÉELLE stockée (la taille déclarée par le client à la
    // création de session n'est pas fiable : l'URL présignée n'impose pas de Content-Length).
    // On vérifie le quota contre la taille effective ; en cas de dépassement, on rejette et
    // on purge l'objet pour ne pas conserver un fichier hors quota.
    const metadata = await storage.getMetadata(session.storageKey);
    const realSize = metadata?.sizeBytes ?? session.sizeBytes;

    const usage = await prisma.mediaAsset.aggregate({
      where: { ownerId: userId, status: { not: "DELETED" } },
      _sum: { sizeBytes: true },
    });
    const totalUsed = BigInt(usage._sum.sizeBytes ?? 0);
    if (totalUsed + realSize > BigInt(CREATOR_QUOTA_BYTES)) {
      await Promise.all([
        storage.deleteObject(session.storageKey).catch(() => {}),
        prisma.uploadSession.update({
          where: { id: uploadSessionId },
          data: { status: "FAILED" },
        }),
      ]);
      throw new Error("QUOTA_EXCEEDED");
    }

    // 1. Créer le MediaAsset en statut PROCESSING (avec la taille réelle)
    const mediaAsset = await prisma.mediaAsset.create({
      data: {
        ownerId: userId,
        uploaderId: userId,
        storageProvider: "R2",
        bucket: process.env.R2_BUCKET_MEDIA || "bamako-podcast-media",
        key: session.storageKey,
        mimeType: session.mimeType,
        sizeBytes: realSize,
        status: "PROCESSING",
      },
    });

    // 2. Mettre à jour la session d'upload
    await prisma.uploadSession.update({
      where: { id: uploadSessionId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        mediaAssetId: mediaAsset.id,
      },
    });

    // 3. Déclencher le job de traitement média (FFprobe / Metadata)
    await prisma.jobQueueItem.create({
      data: {
        queueName: "media-processing",
        jobType: "MEDIA_ANALYZE",
        payload: {
          mediaAssetId: mediaAsset.id,
          episodeId: session.episodeId,
          mediaType: session.mediaType,
        },
      },
    });

    return {
      mediaAssetId: mediaAsset.id,
      status: "PROCESSING",
      message: "Upload complété avec succès. Traitement en cours.",
    };
  }

  static async getUploadSessionStatus(userId: string, uploadSessionId: string) {
    const session = await prisma.uploadSession.findUnique({
      where: { id: uploadSessionId },
      include: { mediaAsset: true },
    });

    if (!session || session.userId !== userId) throw new Error("SESSION_NOT_FOUND");
    return session;
  }
}
