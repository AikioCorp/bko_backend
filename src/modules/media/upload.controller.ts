import { Response } from "express";
import { UploadService } from "./upload.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

export class UploadController {
  static async createUploadSession(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const result = await UploadService.createUploadSession(req.user.id, req.body);
      return sendSuccess(res, result, null, 201);
    } catch (error: any) {
      if (error.message === "INVALID_MEDIA_TYPE") {
        return sendError(res, "Format ou type MIME de fichier non supporté", "INVALID_MEDIA_TYPE", 400);
      }
      if (error.message.startsWith("FILE_TOO_LARGE")) {
        return sendError(res, "Le fichier dépasse la taille maximale autorisée (250 Mo audio / 2 Go vidéo)", "FILE_TOO_LARGE", 400);
      }
      if (error.message === "QUOTA_EXCEEDED") {
        return sendError(res, "Quota de stockage créateur dépassé (10 Go)", "QUOTA_EXCEEDED", 403);
      }
      if (error.message === "EPISODE_NOT_FOUND") {
        return sendError(res, "Épisode introuvable", "EPISODE_NOT_FOUND", 404);
      }
      if (error.message === "FORBIDDEN") {
        return sendError(res, "Vous n'avez pas les droits sur cet épisode", "FORBIDDEN", 403);
      }
      if (error.message === "MARKET_UPLOAD_DISABLED") {
        return sendError(res, "L'upload natif n'est pas autorisé pour votre marché", "MARKET_UPLOAD_DISABLED", 403);
      }
      return sendError(res, error.message);
    }
  }

  static async completeUploadSession(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const result = await UploadService.completeUploadSession(req.user.id, req.params.id);
      return sendSuccess(res, result);
    } catch (error: any) {
      if (error.message === "QUOTA_EXCEEDED") {
        return sendError(res, "Quota de stockage créateur dépassé (10 Go)", "QUOTA_EXCEEDED", 403);
      }
      if (error.message === "SESSION_NOT_FOUND") {
        return sendError(res, "Session d'upload introuvable", "SESSION_NOT_FOUND", 404);
      }
      return sendError(res, error.message);
    }
  }

  static async getUploadSessionStatus(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const session = await UploadService.getUploadSessionStatus(req.user.id, req.params.id);
      return sendSuccess(res, session);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
