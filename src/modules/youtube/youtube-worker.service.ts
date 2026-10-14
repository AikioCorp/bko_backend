import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { SsrfProtectionService } from "../../services/ssrf-protection.service.js";
import { RssParserService, ParsedRssItem } from "../rss/rss-parser.service.js";
import { slugify } from "../creator/creator-profile.service.js";
import { NotificationService } from "../../services/notification.service.js";
import { YouTubeImportSettings } from "./youtube-channel.service.js";

export const YOUTUBE_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 heures par défaut
export const YOUTUBE_ERROR_BACKOFF_MS = 2 * 60 * 60 * 1000;
export const YOUTUBE_JOB_RETRY_DELAY_MS = 30 * 1000;

const WORKER_ID = "youtube-worker-1";

export class YouTubeWorkerService {
  /**
   * Planifie automatiquement les synchronisations des chaînes YouTube dont l'échéance est passée.
   */
  static async scheduleAutoSyncs() {
    const channels = await prisma.youtubeChannelSync.findMany({
      where: {
        syncEnabled: true,
        nextSyncAt: { lte: new Date() },
        syncStatus: { notIn: ["SYNCING", "PENDING"] },
      },
    });

    for (const channel of channels) {
      const lockResult = await prisma.youtubeChannelSync.updateMany({
        where: {
          id: channel.id,
          syncStatus: { notIn: ["SYNCING", "PENDING"] },
        },
        data: {
          syncStatus: "PENDING",
          nextSyncAt: null,
        },
      });

      if (lockResult.count === 0) continue;

      await prisma.jobQueueItem.create({
        data: {
          queueName: "youtube-importer",
          jobType: "YOUTUBE_SYNC_FEED",
          payload: {
            youtubeChannelSyncId: channel.id,
            podcastId: channel.podcastId,
          },
          status: "PENDING",
        },
      });

      console.log(`[YouTube Worker] Synchronisation automatique planifiée pour la chaîne ${channel.channelTitle} (${channel.channelId})`);
    }
  }

  /**
   * Traite la prochaine tâche YouTube en file d'attente (avec verrouillage atomique).
   */
  static async processNextJob(): Promise<boolean> {
    const now = new Date();

    const job = await prisma.$transaction(async (tx) => {
      const pending = await tx.jobQueueItem.findFirst({
        where: {
          status: "PENDING",
          queueName: "youtube-importer",
          runAt: { lte: now },
        },
        orderBy: { runAt: "asc" },
      });

      if (!pending) return null;

      const claimed = await tx.jobQueueItem.updateMany({
        where: { id: pending.id, status: "PENDING" },
        data: {
          status: "PROCESSING",
          lockedAt: now,
          lockedBy: WORKER_ID,
          attempts: { increment: 1 },
        },
      });

      if (claimed.count !== 1) return null;

      return tx.jobQueueItem.findUnique({ where: { id: pending.id } });
    });

    if (!job) return false;

    try {
      const payload = job.payload as any;
      await this.handleSync(
        payload.youtubeChannelSyncId,
        payload.podcastId,
        payload.selectedVideoIds,
        job.jobType === "YOUTUBE_INITIAL_IMPORT"
      );

      await prisma.jobQueueItem.update({
        where: { id: job.id },
        data: { status: "COMPLETED", lastError: null, lockedAt: null, lockedBy: null },
      });
    } catch (err: any) {
      console.error(`[YouTube Worker] Échec tâche #${job.id}:`, err?.message || err);
      const isFinal = job.attempts >= job.maxAttempts;

      await prisma.jobQueueItem.update({
        where: { id: job.id },
        data: {
          status: isFinal ? "FAILED" : "PENDING",
          lastError: err?.message || "Erreur inconnue",
          lockedAt: null,
          lockedBy: null,
          ...(isFinal ? {} : { runAt: new Date(now.getTime() + YOUTUBE_JOB_RETRY_DELAY_MS * job.attempts) }),
        },
      });
    }

    return true;
  }

  /**
   * Exécute l'analyse du flux et la synchronisation des vidéos.
   */
  static async handleSync(
    youtubeChannelSyncId: string,
    podcastId: string,
    selectedVideoIds?: string[],
    isInitialImport = false
  ) {
    const channelSync = await prisma.youtubeChannelSync.findUnique({
      where: { id: youtubeChannelSyncId },
    });
    if (!channelSync) return;

    const podcast = await prisma.podcast.findUnique({ where: { id: podcastId } });
    if (!podcast) return;

    const now = new Date();
    const settings: YouTubeImportSettings = {
      autoPublish: false,
      importScope: "ALL",
      keepManualEdits: true,
      filterKeywords: [],
      excludeKeywords: [],
      ...((channelSync.importSettings as any) || {}),
    };

    // 1. Démarrer la session de synchronisation
    const syncRun = await prisma.youtubeSyncRun.create({
      data: {
        youtubeChannelId: channelSync.id,
        status: "RUNNING",
        startedAt: now,
      },
    });

    await prisma.youtubeChannelSync.update({
      where: { id: channelSync.id },
      data: { syncStatus: "SYNCING", errorMessage: null },
    });

    const counts = { discovered: 0, imported: 0, updated: 0, skipped: 0, failed: 0 };
    const selectedSet = selectedVideoIds ? new Set(selectedVideoIds) : null;

    try {
      // 2. Fetch sécurisé du flux Atom YouTube
      const feedRes = await SsrfProtectionService.safeFetch(channelSync.feedUrl);
      if (feedRes.status !== 200) {
        throw new Error(`HTTP_${feedRes.status}: Impossible de récupérer le flux de la chaîne YouTube.`);
      }

      const parsed = RssParserService.parseXml(feedRes.text);
      counts.discovered = parsed.items.length;

      // 3. Traiter chaque vidéo du flux
      for (const item of parsed.items) {
        const videoId = item.youtubeVideoId;
        if (!videoId) {
          counts.skipped++;
          continue;
        }

        // Si l'import initial cible une sélection explicite de vidéos
        if (selectedSet && !selectedSet.has(videoId)) {
          counts.skipped++;
          continue;
        }

        // Vérification des filtres de mots-clés
        const titleLower = item.title.toLowerCase();
        const descLower = item.description.toLowerCase();

        if (settings.filterKeywords && settings.filterKeywords.length > 0) {
          const matchInc = settings.filterKeywords.some(
            (k) => titleLower.includes(k.toLowerCase()) || descLower.includes(k.toLowerCase())
          );
          if (!matchInc) {
            counts.skipped++;
            continue;
          }
        }

        if (settings.excludeKeywords && settings.excludeKeywords.length > 0) {
          const matchExc = settings.excludeKeywords.some(
            (k) => titleLower.includes(k.toLowerCase()) || descLower.includes(k.toLowerCase())
          );
          if (matchExc) {
            counts.skipped++;
            continue;
          }
        }

        try {
          const outcome = await this.processVideoItem(
            channelSync.id,
            podcastId,
            item,
            settings,
            isInitialImport
          );
          counts[outcome]++;
        } catch (itemErr: any) {
          console.error(`[YouTube Worker] Erreur traitement vidéo ${videoId}:`, itemErr.message);
          counts.failed++;
        }
      }

      // 4. Clôturer la synchronisation avec succès
      const nextSync = channelSync.syncEnabled ? new Date(now.getTime() + YOUTUBE_SYNC_INTERVAL_MS) : null;

      await prisma.youtubeSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "SUCCESS",
          completedAt: new Date(),
          videosDiscovered: counts.discovered,
          videosImported: counts.imported,
          videosUpdated: counts.updated,
          videosSkipped: counts.skipped,
          videosFailed: counts.failed,
        },
      });

      await prisma.youtubeChannelSync.update({
        where: { id: channelSync.id },
        data: {
          syncStatus: channelSync.syncEnabled ? "IDLE" : "PAUSED",
          lastSyncAt: now,
          lastSuccessfulSyncAt: now,
          nextSyncAt: nextSync,
          errorMessage: null,
        },
      });
    } catch (err: any) {
      await prisma.youtubeSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          errorMessage: err?.message || "Erreur inconnue",
        },
      });

      await prisma.youtubeChannelSync.update({
        where: { id: channelSync.id },
        data: {
          syncStatus: "ERROR",
          lastSyncAt: now,
          nextSyncAt: channelSync.syncEnabled ? new Date(now.getTime() + YOUTUBE_ERROR_BACKOFF_MS) : null,
          errorMessage: err?.message || "Erreur lors de la synchronisation",
        },
      });

      throw err;
    }
  }

  /**
   * Importe ou met à jour une vidéo spécifique en tant qu'épisode vidéo YouTube.
   */
  private static async processVideoItem(
    youtubeChannelId: string,
    podcastId: string,
    item: ParsedRssItem,
    settings: YouTubeImportSettings,
    isInitialImport: boolean
  ): Promise<"imported" | "updated" | "skipped"> {
    const videoId = item.youtubeVideoId!;
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;

    // 1. Déduplication : Vérifier si cette vidéo est déjà répertoriée dans cette chaîne YouTube
    const existing = await prisma.youtubeImportedVideo.findUnique({
      where: {
        youtubeChannelId_videoId: {
          youtubeChannelId,
          videoId,
        },
      },
      include: { localEpisode: true },
    });

    if (existing) {
      if (!existing.localEpisodeId || !existing.localEpisode) {
        return "skipped"; // Épisode local supprimé explicitement par l'utilisateur
      }

      let hasChanged = false;

      // Protection des modifications éditoriales locales
      const isProtected = settings.keepManualEdits && existing.localEpisode.isManuallyEdited;

      if (!isProtected && existing.sourceHash !== item.fingerprint) {
        await prisma.episode.update({
          where: { id: existing.localEpisodeId },
          data: {
            title: item.title,
            description: item.description,
            cover: item.thumbnailUrl || existing.localEpisode.cover,
          },
        });

        await prisma.youtubeImportedVideo.update({
          where: { id: existing.id },
          data: { sourceHash: item.fingerprint, videoTitle: item.title },
        });

        hasChanged = true;
      }

      return hasChanged ? "updated" : "skipped";
    }

    // 2. Déduplication croisée : Vérifier si un épisode de cette émission a déjà cette source YouTube
    const existingSource = await prisma.mediaSource.findFirst({
      where: {
        episode: { podcastId },
        type: "VIDEO",
        provider: "YOUTUBE",
        externalId: videoId,
      },
    });

    if (existingSource) {
      // Enregistrer le lien dans youtubeImportedVideo pour mémoire
      await prisma.youtubeImportedVideo.create({
        data: {
          youtubeChannelId,
          videoId,
          videoTitle: item.title,
          videoUrl: canonicalUrl,
          publishedAt: item.pubDate,
          sourceHash: item.fingerprint,
          status: "IMPORTED",
          localEpisodeId: existingSource.episodeId,
        },
      });
      return "skipped";
    }

    // 3. Génération d'un slug unique pour l'épisode
    const slugBase = slugify(item.title) || `video-${videoId}`;
    let slug = slugBase;
    let c = 1;
    while (await prisma.episode.findUnique({ where: { podcastId_slug: { podcastId, slug } } })) {
      c++;
      slug = `${slugBase}-${c}`;
    }

    // 4. Déterminer le statut de publication
    // Brouillon par défaut. La publication automatique n'est appliquée que si explicitement activée.
    const status = settings.autoPublish ? "PUBLISHED" : "DRAFT";

    let createdEpisodeId: string | null = null;

    // 5. Création atomique de l'épisode et de sa source vidéo YouTube
    await prisma.$transaction(async (tx) => {
      const episode = await tx.episode.create({
        data: {
          podcastId,
          title: item.title,
          slug,
          description: item.description,
          durationSeconds: item.durationSeconds || 0,
          publishedAt: item.pubDate || new Date(),
          status,
          creationSource: "EXTERNAL_IMPORT",
          isManuallyEdited: false,
          cover: item.thumbnailUrl,
          audioVideoSyncMode: "EXACT",
          audioVideoOffsetSeconds: 0,
          mediaSources: {
            create: {
              type: "VIDEO",
              sourceType: "RSS_FEED",
              provider: "YOUTUBE",
              playbackMode: "EMBED",
              isPrimaryVideo: true,
              isPrimaryAudio: false,
              externalId: videoId,
              externalUrl: canonicalUrl,
              embedUrl,
              durationSeconds: item.durationSeconds > 0 ? item.durationSeconds : null,
              mimeType: "video/youtube",
              status: "ACTIVE",
            },
          },
        },
      });

      createdEpisodeId = episode.id;

      await tx.youtubeImportedVideo.create({
        data: {
          youtubeChannelId,
          videoId,
          videoTitle: item.title,
          videoUrl: canonicalUrl,
          publishedAt: item.pubDate,
          sourceHash: item.fingerprint,
          status: "IMPORTED",
          localEpisodeId: episode.id,
        },
      });
    });

    // 6. Notification silencieuse lors de l'import initial / historique.
    // Seules les nouvelles publications confirmées lors de synchronisations ultérieures déclenchent une notification.
    if (!isInitialImport && status === "PUBLISHED" && createdEpisodeId) {
      void NotificationService.notifyFollowersOfEpisode(createdEpisodeId);
    }

    return "imported";
  }
}
