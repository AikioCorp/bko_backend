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

      return sendSuccess(res, episode);
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
}
