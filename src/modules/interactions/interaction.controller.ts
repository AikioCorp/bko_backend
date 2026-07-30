import { Response } from "express";
import { InteractionService } from "./interaction.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

export class InteractionController {
  static async followPodcast(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const result = await InteractionService.followPodcast(req.user.id, req.params.id);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async unfollowPodcast(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const result = await InteractionService.unfollowPodcast(req.user.id, req.params.id);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async saveEpisode(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const result = await InteractionService.saveEpisode(req.user.id, req.params.id);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async unsaveEpisode(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const result = await InteractionService.unsaveEpisode(req.user.id, req.params.id);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getSavedEpisodes(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const saved = await InteractionService.getSavedEpisodes(req.user.id);
      return sendSuccess(res, saved);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async updatePlaybackHistory(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { episodeId, positionSeconds, durationSeconds } = req.body;
      const result = await InteractionService.updatePlaybackHistory(
        req.user.id,
        episodeId,
        positionSeconds,
        durationSeconds
      );
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getContinueListening(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const histories = await InteractionService.getContinueListening(req.user.id);
      return sendSuccess(res, histories);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getHistory(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const history = await InteractionService.getHistory(req.user.id);
      return sendSuccess(res, history);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async clearHistory(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const result = await InteractionService.clearHistory(req.user.id);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
