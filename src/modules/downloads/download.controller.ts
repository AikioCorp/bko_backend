import { Response } from "express";
import { DownloadService } from "./download.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

export class DownloadController {
  /**
   * Enregistrement / heartbeat de l'appareil mobile
   * POST /api/v1/downloads/device-sync
   */
  static async syncDevice(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const result = await DownloadService.syncDevice(req.user.id, req.body);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  /**
   * Vérifie si l'utilisateur possède un appareil mobile connecté
   * GET /api/v1/downloads/device-status
   */
  static async getDeviceStatus(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const status = await DownloadService.getMobileDeviceStatus(req.user.id);
      return sendSuccess(res, status);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  /**
   * Envoie un ordre de téléchargement distant depuis le web vers le mobile
   * POST /api/v1/downloads/remote-queue
   */
  static async queueRemoteDownload(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { episodeId, clientSource } = req.body;
      if (!episodeId) {
        return sendError(res, "L'identifiant de l'épisode est obligatoire", "BAD_REQUEST", 400);
      }
      const result = await DownloadService.queueRemoteDownload(
        req.user.id,
        episodeId,
        clientSource || "WEB"
      );
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  /**
   * Récupère la liste des téléchargements en attente (appelé par le mobile)
   * GET /api/v1/downloads/remote-queue
   */
  static async getPendingRemoteDownloads(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const items = await DownloadService.getPendingRemoteDownloads(req.user.id);
      return sendSuccess(res, items);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  /**
   * Confirme la prise en compte / fin d'un téléchargement distant
   * POST /api/v1/downloads/remote-queue/:id/ack
   */
  static async ackRemoteDownload(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const queueId = req.params.id;
      const { status } = req.body;
      const result = await DownloadService.ackRemoteDownload(
        req.user.id,
        queueId,
        status || "COMPLETED"
      );
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
