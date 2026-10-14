import { Response } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import { prisma } from "../../config/prisma.js";
import { YouTubeChannelService } from "../youtube/youtube-channel.service.js";
import { YouTubeResolverService } from "../youtube/youtube-resolver.service.js";
import { slugify } from "../creator/creator-profile.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";

export class AdminYouTubeController {
  /**
   * POST /admin/youtube/preview
   */
  static async preview(req: AuthenticatedRequest, res: Response) {
    try {
      const { url } = req.body;
      if (!url) return sendError(res, "URL ou identifiant YouTube requis.", "BAD_REQUEST", 400);

      const data = await YouTubeChannelService.previewChannel(url);
      return sendSuccess(res, data, "Prévisualisation de la chaîne YouTube réussie.");
    } catch (err: any) {
      return sendError(res, err.message || "Erreur de prévisualisation.", "ADMIN_YOUTUBE_ERROR", 400);
    }
  }

  /**
   * POST /admin/youtube/imports
   * Crée une nouvelle émission (ou lie une émission existante) et démarre l'importation de la chaîne YouTube
   */
  static async createImport(req: AuthenticatedRequest, res: Response) {
    try {
      const {
        channelUrl,
        existingPodcastId,
        name,
        description,
        cover,
        languageCode,
        categoryIds,
        countryId,
        autoPublish,
        selectedVideoIds,
      } = req.body;

      if (!channelUrl) return sendError(res, "URL ou identifiant YouTube requis.", "BAD_REQUEST", 400);

      // Résolution de la chaîne
      const channel = await YouTubeResolverService.resolveChannel(channelUrl);

      let targetPodcastId = existingPodcastId;

      if (!targetPodcastId) {
        // Créer une nouvelle émission
        if (!name) return sendError(res, "Le nom de l'émission est obligatoire.", "BAD_REQUEST", 400);

        const slugBase = slugify(name) || "emission-youtube";
        let slug = slugBase;
        let c = 1;
        while (await prisma.podcast.findUnique({ where: { slug } })) {
          c++;
          slug = `${slugBase}-${c}`;
        }

        const podcast = await prisma.podcast.create({
          data: {
            name,
            slug,
            description: description || channel.description || `Chaîne YouTube ${channel.title}`,
            shortDescription: (description || channel.description || "").slice(0, 160),
            cover: cover || channel.thumbnailUrl || "https://images.unsplash.com/photo-1590602847861-f357a9332bbc?q=80&w=600",
            primaryLanguageCode: languageCode || "fr",
            countryId: countryId || "ML",
            status: autoPublish ? "PUBLISHED" : "DRAFT",
            creationSource: "ADMIN",
            qualityScore: 85,
            ownershipStatus: "UNCLAIMED",
            managedByBamakoPodcast: true,
            categories: categoryIds && categoryIds.length > 0 ? {
              create: categoryIds.map((cid: string) => ({ categoryId: cid })),
            } : undefined,
          },
        });
        targetPodcastId = podcast.id;
      }

      // Connecter la chaîne à l'émission
      const connectResult = await YouTubeChannelService.connectChannel(req.user!.id, targetPodcastId, {
        channelId: channel.channelId,
        channelTitle: channel.title,
        channelDescription: channel.description,
        thumbnailUrl: channel.thumbnailUrl,
        customUrl: channel.customUrl,
        uploadsPlaylistId: channel.uploadsPlaylistId,
        feedUrl: channel.feedUrl,
        selectedVideoIds,
        settings: {
          autoPublish: !!autoPublish,
          keepManualEdits: true,
          importScope: selectedVideoIds && selectedVideoIds.length > 0 ? "SELECT" : "ALL",
        },
      });

      return sendSuccess(
        res,
        { podcastId: targetPodcastId, ...connectResult },
        "Importation de la chaîne YouTube lancée avec succès."
      );
    } catch (err: any) {
      return sendError(res, err.message || "Erreur lors de la création de l'import.", "ADMIN_YOUTUBE_ERROR", 400);
    }
  }

  /**
   * POST /admin/podcasts/:podcastId/youtube/sync
   */
  static async syncChannelNow(req: AuthenticatedRequest, res: Response) {
    try {
      const podcastId = req.params.podcastId;
      const channel = await prisma.youtubeChannelSync.findUnique({ where: { podcastId } });
      if (!channel) return sendError(res, "Aucune chaîne YouTube n'est liée à cette émission.", "NOT_FOUND", 404);

      await prisma.jobQueueItem.create({
        data: {
          queueName: "youtube-importer",
          jobType: "YOUTUBE_SYNC_FEED",
          payload: {
            youtubeChannelSyncId: channel.id,
            podcastId,
          },
          status: "PENDING",
        },
      });

      return sendSuccess(res, { success: true }, "Synchronisation planifiée.");
    } catch (err: any) {
      return sendError(res, err.message, "ADMIN_YOUTUBE_ERROR", 400);
    }
  }

  /**
   * GET /admin/podcasts/:podcastId/youtube
   */
  static async getChannelStatus(req: AuthenticatedRequest, res: Response) {
    try {
      const podcastId = req.params.podcastId;
      const channel = await prisma.youtubeChannelSync.findUnique({
        where: { podcastId },
        include: {
          syncRuns: { orderBy: { startedAt: "desc" }, take: 10 },
          _count: { select: { importedVideos: true } },
        },
      });
      return sendSuccess(res, channel);
    } catch (err: any) {
      return sendError(res, err.message, "ADMIN_YOUTUBE_ERROR", 400);
    }
  }

  /**
   * PATCH /admin/podcasts/:podcastId/youtube/settings
   */
  static async updateSettings(req: AuthenticatedRequest, res: Response) {
    try {
      const podcastId = req.params.podcastId;
      const channel = await prisma.youtubeChannelSync.findUnique({ where: { podcastId } });
      if (!channel) return sendError(res, "Chaîne non trouvée", "NOT_FOUND", 404);

      const currentSettings = (channel.importSettings as any) || {};
      const updatedSettings = req.body.settings ? { ...currentSettings, ...req.body.settings } : currentSettings;

      const updated = await prisma.youtubeChannelSync.update({
        where: { podcastId },
        data: {
          syncEnabled: req.body.syncEnabled !== undefined ? req.body.syncEnabled : channel.syncEnabled,
          importSettings: updatedSettings,
          syncStatus: req.body.syncEnabled === false ? "PAUSED" : (channel.syncStatus === "PAUSED" ? "IDLE" : channel.syncStatus),
        },
      });

      return sendSuccess(res, updated, "Paramètres mis à jour.");
    } catch (err: any) {
      return sendError(res, err.message, "ADMIN_YOUTUBE_ERROR", 400);
    }
  }

  /**
   * DELETE /admin/podcasts/:podcastId/youtube
   */
  static async disconnectChannel(req: AuthenticatedRequest, res: Response) {
    try {
      const podcastId = req.params.podcastId;
      const deleteEpisodes = req.query.deleteEpisodes === "true";

      const channel = await prisma.youtubeChannelSync.findUnique({ where: { podcastId } });
      if (!channel) return sendError(res, "Chaîne non trouvée", "NOT_FOUND", 404);

      if (deleteEpisodes) {
        const imported = await prisma.youtubeImportedVideo.findMany({
          where: { youtubeChannelId: channel.id, localEpisodeId: { not: null } },
          select: { localEpisodeId: true },
        });
        const epIds = imported.map((i) => i.localEpisodeId as string);
        if (epIds.length > 0) {
          await prisma.episode.deleteMany({ where: { id: { in: epIds } } });
        }
      }

      await prisma.youtubeChannelSync.delete({ where: { podcastId } });
      return sendSuccess(res, { success: true }, "Chaîne YouTube déconnectée.");
    } catch (err: any) {
      return sendError(res, err.message, "ADMIN_YOUTUBE_ERROR", 400);
    }
  }

  /**
   * GET /admin/youtube/imports
   * Liste toutes les chaînes YouTube connectées et leur état
   */
  static async listChannels(req: AuthenticatedRequest, res: Response) {
    try {
      const channels = await prisma.youtubeChannelSync.findMany({
        include: {
          podcast: { select: { id: true, name: true, slug: true, cover: true } },
          syncRuns: { orderBy: { startedAt: "desc" }, take: 1 },
          _count: { select: { importedVideos: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return sendSuccess(res, channels);
    } catch (err: any) {
      return sendError(res, err.message, "ADMIN_YOUTUBE_ERROR", 400);
    }
  }

  /**
   * POST /admin/podcasts/:podcastId/youtube/historical-import
   */
  static async historicalImport(req: AuthenticatedRequest, res: Response) {
    try {
      const podcastId = req.params.podcastId;
      const data = await YouTubeChannelService.historicalImport(req.user!.id, podcastId, req.body);
      return sendSuccess(res, data, "Vidéos historiques récupérées.");
    } catch (err: any) {
      return sendError(res, err.message, "ADMIN_YOUTUBE_ERROR", 400);
    }
  }
}
