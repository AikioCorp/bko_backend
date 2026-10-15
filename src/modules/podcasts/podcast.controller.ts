import { prisma } from "../../config/prisma.js";
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
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
      const sort = (req.query.sort as any) || "recent";
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const hasContent = req.query.hasContent === "true" || req.query.hasContent === "1" || req.query.hasEpisodes === "true";

      const result = await PodcastService.getPodcasts({
        countryId,
        languageCode,
        categorySlug,
        topicSlug,
        search,
        cursor,
        offset,
        sort,
        limit,
        hasContent,
      });

      return sendSuccess(res, result.data, { pagination: result.pagination });
    } catch (error: any) {
      return sendError(res, error.message || "Impossible de récupérer les podcasts.");
    }
  }

  static async getPodcastBySlug(req: Request, res: Response) {
    try {
      const { slug } = req.params;
      const episodeLimit = req.query.episodeLimit === undefined ? undefined : Number(req.query.episodeLimit);
      const episodeOffset = req.query.episodeOffset === undefined ? 0 : Number(req.query.episodeOffset);
      if ((episodeLimit !== undefined && (!Number.isInteger(episodeLimit) || episodeLimit < 1 || episodeLimit > 100)) || !Number.isInteger(episodeOffset) || episodeOffset < 0) {
        return sendError(res, "Pagination des épisodes invalide", "BAD_REQUEST", 400);
      }
      const episodeSort = req.query.episodeSort ?? "recent";
      const episodeType = req.query.episodeType;
      if ((episodeSort !== "recent" && episodeSort !== "oldest") ||
          (episodeType !== undefined && episodeType !== "AUDIO" && episodeType !== "VIDEO")) {
        return sendError(res, "Filtre des épisodes invalide", "BAD_REQUEST", 400);
      }
      const podcast = await PodcastService.getPodcastBySlug(slug, episodeLimit, episodeOffset,
        episodeSort as "recent" | "oldest", episodeType as "AUDIO" | "VIDEO" | undefined);

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

  static async getSimilarPodcasts(req: Request, res: Response) {
    try {
      const { slug } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 8;
      const podcast = await prisma.podcast.findUnique({
        where: { slug },
        select: { id: true },
      });

      if (!podcast) {
        return sendError(res, "Podcast introuvable", "PODCAST_NOT_FOUND", 404);
      }

      const similar = await PodcastService.getSimilarPodcasts(podcast.id, limit);
      return sendSuccess(res, similar, "Émissions similaires récupérées.");
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la récupération des émissions similaires.");
    }
  }
}
