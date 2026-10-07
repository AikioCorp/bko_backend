import { Response } from "express";
import { AdminEpisodeService, AdminEpisodeError } from "./admin-episode.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

export class AdminEpisodeController {
  private static handleError(res: Response, e: any) {
    if (e instanceof AdminEpisodeError) {
      return sendError(res, e.message, e.code, e.status);
    }
    return sendError(res, e.message || "Erreur interne", "INTERNAL_ERROR", 500);
  }

  static async get(req: AuthenticatedRequest, res: Response) {
    try {
      const ep = await AdminEpisodeService.get(req.params.id);
      if (!ep) return sendError(res, "Épisode introuvable", "NOT_FOUND", 404);
      return sendSuccess(res, ep);
    } catch (e: any) {
      return AdminEpisodeController.handleError(res, e);
    }
  }

  static async createDraft(req: AuthenticatedRequest, res: Response) {
    try {
      const ep = await AdminEpisodeService.createDraft(req.user!.id, req.params.podcastId, req.body);
      return sendSuccess(res, ep, "Brouillon créé.", 201);
    } catch (e: any) {
      return AdminEpisodeController.handleError(res, e);
    }
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    try {
      const ep = await AdminEpisodeService.update(req.user!.id, req.params.id, req.body);
      return sendSuccess(res, ep, "Informations mises à jour.");
    } catch (e: any) {
      return AdminEpisodeController.handleError(res, e);
    }
  }

  static async createAudioUpload(req: AuthenticatedRequest, res: Response) {
    try {
      const data = await AdminEpisodeService.createAudioUpload(req.user!.id, req.params.id, req.body);
      return sendSuccess(res, data, "Session d'envoi créée.");
    } catch (e: any) {
      return AdminEpisodeController.handleError(res, e);
    }
  }

  static async completeAudioUpload(req: AuthenticatedRequest, res: Response) {
    try {
      const ep = await AdminEpisodeService.completeAudioUpload(req.user!.id, req.params.id, req.params.uploadId);
      return sendSuccess(res, ep, "Envoi terminé. Traitement en cours.");
    } catch (e: any) {
      return AdminEpisodeController.handleError(res, e);
    }
  }

  static async setAudioUrl(req: AuthenticatedRequest, res: Response) {
    try {
      const ep = await AdminEpisodeService.setAudioUrl(req.user!.id, req.params.id, req.body.url);
      return sendSuccess(res, ep, "Adresse audio vérifiée et enregistrée.");
    } catch (e: any) {
      return AdminEpisodeController.handleError(res, e);
    }
  }

  static async removeAudio(req: AuthenticatedRequest, res: Response) {
    try {
      const ep = await AdminEpisodeService.removeAudio(req.user!.id, req.params.id);
      return sendSuccess(res, ep, "Source audio retirée.");
    } catch (e: any) {
      return AdminEpisodeController.handleError(res, e);
    }
  }

  static async previewYoutube(req: AuthenticatedRequest, res: Response) {
    try {
      const data = await AdminEpisodeService.previewYoutube(req.body.url);
      return sendSuccess(res, data);
    } catch (e: any) {
      return AdminEpisodeController.handleError(res, e);
    }
  }

  static async setYoutube(req: AuthenticatedRequest, res: Response) {
    try {
      const ep = await AdminEpisodeService.setYoutube(req.user!.id, req.params.id, req.body);
      return sendSuccess(res, ep, "Vidéo YouTube associée.");
    } catch (e: any) {
      return AdminEpisodeController.handleError(res, e);
    }
  }

  static async reportYoutubeCheck(req: AuthenticatedRequest, res: Response) {
    try {
      const ep = await AdminEpisodeService.reportYoutubeCheck(req.params.id, req.body);
      return sendSuccess(res, ep);
    } catch (e: any) {
      return AdminEpisodeController.handleError(res, e);
    }
  }

  static async removeYoutube(req: AuthenticatedRequest, res: Response) {
    try {
      const ep = await AdminEpisodeService.removeYoutube(req.user!.id, req.params.id);
      return sendSuccess(res, ep, "Vidéo YouTube retirée.");
    } catch (e: any) {
      return AdminEpisodeController.handleError(res, e);
    }
  }

  static async publish(req: AuthenticatedRequest, res: Response) {
    try {
      const ep = await AdminEpisodeService.publish(req.user!.id, req.params.id, req.body);
      return sendSuccess(res, ep, ep?.status === "SCHEDULED" ? "Épisode programmé." : "Épisode publié.");
    } catch (e: any) {
      return AdminEpisodeController.handleError(res, e);
    }
  }
}
