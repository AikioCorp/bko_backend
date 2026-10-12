import { ViewerService } from "../interactions/viewer.service.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import { formatEpisodeWithMediaFlags } from "../../utils/episode.js";
import { Request, Response } from "express";
import { EpisodeService } from "./episode.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";

export class EpisodeController {
  static async getEpisodeBySlug(req: Request, res: Response) {
    try {
      const { podcastSlug, episodeSlug } = req.params;
      const episode = await EpisodeService.getEpisodeBySlug(podcastSlug, episodeSlug);

      if (!episode) {
        return sendError(res, "Épisode introuvable", "EPISODE_NOT_FOUND", 404);
      }

      const userId = (req as AuthenticatedRequest).user?.id;
      const viewer = userId ? await ViewerService.forEpisode(userId, episode.id, episode.podcastId) : null;
      return sendSuccess(res, { ...formatEpisodeWithMediaFlags(episode), viewer });
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la récupération de l'épisode.");
    }
  }

  static async listRecentEpisodes(req: Request, res: Response) {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      const result = await EpisodeService.getRecentEpisodes(limit, offset);

      return sendSuccess(res, result.episodes, {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      });
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la récupération des récents épisodes.");
    }
  }

  static async listCatalogEpisodes(req: Request, res: Response) {
    try {
      const search = req.query.q as string | undefined;
      const categorySlug = req.query.category as string | undefined;
      const languageCode = req.query.lang as string | undefined;
      const countryId = req.query.country as string | undefined;
      const mediaType = (req.query.mediaType as any) || "ALL";
      const duration = (req.query.duration as any) || "ALL";
      const sort = (req.query.sort as any) || "recent";
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 24;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      const result = await EpisodeService.getCatalogEpisodes({
        search,
        categorySlug,
        languageCode,
        countryId,
        mediaType,
        duration,
        sort,
        limit,
        offset,
      });

      return sendSuccess(res, result.episodes, {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.hasMore,
      });
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la récupération du catalogue d'épisodes.");
    }
  }
}

