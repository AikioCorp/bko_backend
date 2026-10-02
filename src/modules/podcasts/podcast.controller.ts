import { ViewerService } from "../interactions/viewer.service.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import { Request, Response } from "express";
import { PodcastService } from "./podcast.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";

export class PodcastController {
  static async listPodcasts(req: Request, res: Response) {
    try {
      const countryId = req.query.country as string | undefined;
      const languageCode = req.query.language as string | undefined;
      const categorySlug = req.query.category as string | undefined;
      const topicSlug = req.query.topic as string | undefined;
      const search = req.query.q as string | undefined;
      const cursor = req.query.cursor as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await PodcastService.getPodcasts({
        countryId,
        languageCode,
        categorySlug,
        topicSlug,
        search,
        cursor,
        limit,
      });

      return sendSuccess(res, result.data, { pagination: result.pagination });
    } catch (error: any) {
      return sendError(res, error.message || "Impossible de récupérer les podcasts.");
    }
  }

  static async getPodcastBySlug(req: Request, res: Response) {
    try {
      const { slug } = req.params;
      const podcast = await PodcastService.getPodcastBySlug(slug);

      if (!podcast) {
        return sendError(res, "Podcast introuvable", "PODCAST_NOT_FOUND", 404);
      }

      const userId = (req as AuthenticatedRequest).user?.id;
      const viewer = userId ? await ViewerService.forPodcast(userId, podcast.id, podcast.episodes.map((e: any) => e.id)) : null;
      return sendSuccess(res, { ...podcast, viewer });
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la récupération du podcast.");
    }
  }
}
