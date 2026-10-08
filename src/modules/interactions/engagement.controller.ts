import { Response } from "express";
import { EngagementService } from "./engagement.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import { Request } from "express";

export class EngagementController {
  // --- RATINGS ---
  static async ratePodcast(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { score } = req.body;
      const result = await EngagementService.ratePodcast(req.params.id, req.user.id, score);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getPodcastRatings(req: Request, res: Response) {
    try {
      // Note: user is attached if optionalAuthenticateToken was used.
      const userId = (req as any).user?.id;
      const result = await EngagementService.getPodcastRatings(req.params.id, userId);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async deletePodcastRating(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      await EngagementService.deletePodcastRating(req.params.id, req.user.id);
      return sendSuccess(res, { success: true });
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  // --- LIKES ---
  static async likeEpisode(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const result = await EngagementService.likeEpisode(req.params.id, req.user.id);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async unlikeEpisode(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      await EngagementService.unlikeEpisode(req.params.id, req.user.id);
      return sendSuccess(res, { success: true });
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  // --- COMMENTS ---
  static async listComments(req: Request, res: Response) {
    try {
      const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
      const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
      const result = await EngagementService.listComments(req.params.id, limit, offset);
      return sendSuccess(res, result.comments, { total: result.total, limit, offset });
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async createComment(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { text } = req.body;
      const result = await EngagementService.createComment(req.params.id, req.user.id, text);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async deleteComment(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      // For now, only the author can delete. Mods can be added later via roles.
      // E.g. const isMod = req.user.role === 'ADMIN' || req.user.role === 'MODERATOR';
      const result = await EngagementService.deleteComment(req.params.id, req.user.id);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async updateCommentSettings(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      // Ensure user owns the podcast or is admin, but since it's an internal route we assume middleware did it or we just allow it for now
      // In a real app we'd verify Ownership via CreatorService.
      const { allowComments } = req.body;
      const result = await EngagementService.updateCommentSettings(req.params.episodeId, allowComments, req.user.id);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
