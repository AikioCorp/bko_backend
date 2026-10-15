import { Request, Response } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import { YouTubeChannelService } from "./youtube-channel.service.js";
import { YouTubeWebSubService } from "./youtube-websub.service.js";
import { prisma } from "../../config/prisma.js";
import { sendSuccess, sendError } from "../../utils/response.js";

export class YouTubeController {
  /**
   * POST /creator/youtube/preview
   * Prévisualisation d'une chaîne YouTube avant connexion
   */
  static async previewChannel(req: AuthenticatedRequest, res: Response) {
    try {
      const { url } = req.body;
      if (!url) {
        return sendError(res, "Veuillez fournir une URL de chaîne ou un identifiant YouTube.", "BAD_REQUEST", 400);
      }
      if(req.body.podcastId){const member=await prisma.podcastMember.findUnique({where:{podcastId_userId:{podcastId:req.body.podcastId,userId:req.user!.id}}});if(!member)return sendError(res,"Vous n’avez pas accès à cette émission.","FORBIDDEN",403);}
      const data = await YouTubeChannelService.previewChannel(url, req.body.podcastId, req.body.pageToken);
      return sendSuccess(res, data, "Chaîne YouTube analysée.");
    } catch (err: any) {
      return sendError(res, err.message || "Impossible d'analyser cette chaîne YouTube.", "YOUTUBE_ERROR", 400);
    }
  }

  /**
   * POST /creator/podcasts/:podcastId/youtube/connect
   * Connexion d'une chaîne YouTube à une émission
   */
  static async connectChannel(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const podcastId = req.params.podcastId;
      const data = await YouTubeChannelService.connectChannel(userId, podcastId, req.body);
      return sendSuccess(res, data, data.message);
    } catch (err: any) {
      const status = err.message.startsWith("FORBIDDEN") ? 403 : 400;
      return sendError(res, err.message, "YOUTUBE_ERROR", status);
    }
  }

  /**
   * POST /creator/podcasts/:podcastId/youtube/sync
   * Déclenche une synchronisation immédiate de la chaîne
   */
  static async syncChannelNow(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const podcastId = req.params.podcastId;
      const result = await YouTubeChannelService.syncChannelNow(userId, podcastId);
      return sendSuccess(res, result, result.message);
    } catch (err: any) {
      const status = err.message.startsWith("FORBIDDEN") ? 403 : 400;
      return sendError(res, err.message, "YOUTUBE_ERROR", status);
    }
  }

  /**
   * GET /creator/podcasts/:podcastId/youtube
   * Récupère le statut et l'historique de synchronisation
   */
  static async getChannelStatus(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const podcastId = req.params.podcastId;
      const data = await YouTubeChannelService.getChannelStatus(userId, podcastId);
      return sendSuccess(res, data);
    } catch (err: any) {
      const status = err.message.startsWith("FORBIDDEN") ? 403 : 400;
      return sendError(res, err.message, "YOUTUBE_ERROR", status);
    }
  }

  /**
   * PATCH /creator/podcasts/:podcastId/youtube/settings
   * Met à jour les réglages d'import ou suspend/reprend la synchronisation
   */
  static async updateSettings(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const podcastId = req.params.podcastId;
      const updated = await YouTubeChannelService.updateSettings(userId, podcastId, req.body);
      return sendSuccess(res, updated, "Réglages de la chaîne YouTube mis à jour.");
    } catch (err: any) {
      const status = err.message.startsWith("FORBIDDEN") ? 403 : 400;
      return sendError(res, err.message, "YOUTUBE_ERROR", status);
    }
  }

  /**
   * DELETE /creator/podcasts/:podcastId/youtube
   * Déconnecte la chaîne YouTube (garde les épisodes par défaut)
   */
  static async disconnectChannel(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const podcastId = req.params.podcastId;
      const deleteEpisodes = req.query.deleteEpisodes === "true";
      const result = await YouTubeChannelService.disconnectChannel(userId, podcastId, deleteEpisodes);
      return sendSuccess(res, result, result.message);
    } catch (err: any) {
      const status = err.message.startsWith("FORBIDDEN") ? 403 : 400;
      return sendError(res, err.message, "YOUTUBE_ERROR", status);
    }
  }

  /**
   * POST /creator/podcasts/:podcastId/youtube/historical-import
   * Paginer et importer les anciennes vidéos via YouTube Data API v3
   */
  static async historicalImport(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const podcastId = req.params.podcastId;
      const data = await YouTubeChannelService.historicalImport(userId, podcastId, req.body);
      return sendSuccess(res, data, "Vidéos historiques récupérées.");
    } catch (err: any) {
      return sendError(res, err.message, "YOUTUBE_ERROR", 400);
    }
  }

  /**
   * GET /webhooks/youtube
   * Validation de l'abonnement WebSub par Google (hub.challenge)
   */
  static async handleWebSubChallenge(req: Request, res: Response) {
    const { valid, challenge } = YouTubeWebSubService.handleChallenge(req.query as Record<string, any>);
    if (valid && challenge) {
      return res.status(200).type("text/plain").send(challenge);
    }
    return res.status(404).send("Invalid WebSub challenge");
  }

  /**
   * POST /webhooks/youtube
   * Notification push en temps réel de YouTube (Atom XML)
   */
  static async handleWebSubNotification(req: Request, res: Response) {
    try {
      const topic = (req.query["hub.topic"] as string) || "";
      const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body || "");
      const signature = req.headers["x-hub-signature"] as string | undefined;

      // Chercher le channelId depuis le topic ou le XML
      let channelId = "";
      if (topic) {
        try {
          const urlObj = new URL(topic);
          channelId = urlObj.searchParams.get("channel_id") || "";
        } catch {
          // ignore
        }
      }

      if (!channelId && typeof rawBody === "string") {
        const match = rawBody.match(/<yt:channelId>(.*?)<\/yt:channelId>/);
        if (match) channelId = match[1].trim();
      }

      if (!channelId) {
        return res.status(204).end();
      }

      const syncRecord = await prisma.youtubeChannelSync.findFirst({
        where: { channelId },
      });

      if (!syncRecord || !syncRecord.syncEnabled) {
        return res.status(204).end();
      }

      // Si un secret webhook est configuré, vérifier la signature HMAC-SHA1
      if (syncRecord.webSubSecret) {
        const validSig = YouTubeWebSubService.verifySignature(rawBody, signature || "", syncRecord.webSubSecret);
        if (!validSig) {
          console.warn(`[WebSub] Signature invalide reçue pour la chaîne ${channelId}`);
          return res.status(403).send("Invalid signature");
        }
      }

      // Planifier immédiatement un job de synchronisation en tâche de fond
      await prisma.jobQueueItem.create({
        data: {
          queueName: "youtube-importer",
          jobType: "YOUTUBE_SYNC_FEED",
          payload: {
            youtubeChannelSyncId: syncRecord.id,
            podcastId: syncRecord.podcastId,
          },
          status: "PENDING",
        },
      });

      return res.status(204).end();
    } catch (err: any) {
      console.error("[WebSub] Erreur traitement notification:", err);
      return res.status(204).end();
    }
  }
}

