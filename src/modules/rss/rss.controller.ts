import { Response } from "express";
import { RssImportService } from "./rss-import.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

export class RssController {
  static async previewFeed(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { feedUrl } = req.body;
      if (!feedUrl) return sendError(res, "Lien du flux RSS requis", "VALIDATION_ERROR", 400);

      const preview = await RssImportService.previewFeed(req.user.id, req.params.podcastId, feedUrl);
      return sendSuccess(res, preview);
    } catch (error: any) {
      if (error.message === "MARKET_RSS_IMPORT_DISABLED") {
        return sendError(res, "L'importation de flux RSS n'est pas activée pour ce pays", "MARKET_RSS_IMPORT_DISABLED", 403);
      }
      if (error.message === "RSS_SSRF_BLOCKED") {
        return sendError(res, "Lien RSS refusé (protection sécurité SSRF)", "SSRF_BLOCKED", 400);
      }
      return sendError(res, error.message || "Impossible d'analyser le flux RSS");
    }
  }

  static async connectFeed(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { feedUrl } = req.body;
      const result = await RssImportService.connectFeed(req.user.id, req.params.podcastId, feedUrl);
      return sendSuccess(res, result, null, 201);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async syncFeedNow(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const result = await RssImportService.syncFeedNow(req.user.id, req.params.podcastId);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async disconnectFeed(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const result = await RssImportService.disconnectFeed(req.user.id, req.params.podcastId);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getFeedStatus(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const status = await RssImportService.getFeedStatus(req.user.id, req.params.podcastId);
      return sendSuccess(res, status);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
