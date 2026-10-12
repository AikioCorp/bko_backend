import { Response } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import { PersonalizationEngineService } from "./personalization-engine.service.js";
import { UserProfileService } from "./user-profile.service.js";
import { InteractionCollectorService } from "./interaction-collector.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { prisma } from "../../config/prisma.js";

export class RecommendationController {
  /**
   * GET /api/v1/home
   * Accueil personnalisé multicanal
   */
  static async getHome(req: AuthenticatedRequest, res: Response) {
    try {
      const country = (req.query.country as string) || "all";
      const category = (req.query.category as string) || "all";
      const cursor = (req.query.cursor as string) || undefined;
      // L'authentification vérifiée côté serveur prime de manière absolue sur tout paramètre d'URL
      const verifiedUserId = req.user?.id;
      const anonymousId = (req.headers["x-anonymous-id"] as string) || (req.query.anon as string) || undefined;

      const data = await PersonalizationEngineService.getPersonalizedHome(
        verifiedUserId,
        anonymousId,
        country,
        category,
        cursor
      );

      // En-têtes HTTP de cache privé/public
      if (verifiedUserId) {
        res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");
      } else {
        res.setHeader("Cache-Control", "public, max-age=60, s-maxage=120, stale-while-revalidate=300");
      }

      return sendSuccess(res, data);
    } catch (error: any) {
      console.error("[RecommendationController.getHome] Error:", error);
      return sendError(res, error.message || "Erreur lors du chargement de l'accueil.");
    }
  }

  /**
   * GET /api/v1/home/feed
   * Suite paginée du flux d'accueil pour le défilement infini
   */
  static async getHomeFeed(req: AuthenticatedRequest, res: Response) {
    try {
      const country = (req.query.country as string) || "all";
      const category = (req.query.category as string) || "all";
      const cursor = (req.query.cursor as string) || undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 12;
      const verifiedUserId = req.user?.id;
      const anonymousId = (req.headers["x-anonymous-id"] as string) || (req.query.anon as string) || undefined;

      const data = await PersonalizationEngineService.getFeed(
        verifiedUserId,
        anonymousId,
        country,
        category,
        cursor,
        limit
      );

      if (verifiedUserId) {
        res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");
      } else {
        res.setHeader("Cache-Control", "public, max-age=60, s-maxage=120, stale-while-revalidate=300");
      }

      return sendSuccess(res, data);
    } catch (error: any) {
      console.error("[RecommendationController.getHomeFeed] Error:", error);
      return sendError(res, error.message || "Erreur lors du chargement du flux.");
    }
  }

  /**
   * POST /api/v1/recommendations/feedback
   * Retours explicites : pas intéressé, masquer l'émission, exclure d'une écoute
   */
  static async postFeedback(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Authentification requise", "UNAUTHORIZED", 401);
      const { targetType, targetId, action } = req.body;
      if (!targetType || !targetId || !action) {
        return sendError(res, "targetType, targetId et action requis", "BAD_REQUEST", 400);
      }

      const result = await UserProfileService.recordFeedback(
        req.user.id,
        targetType,
        targetId,
        action
      );
      PersonalizationEngineService.invalidateUserCache(req.user.id);
      return sendSuccess(res, result, "Préférence prise en compte");
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  /**
   * DELETE /api/v1/recommendations/feedback
   * Annulation d'un retour explicite
   */
  static async deleteFeedback(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Authentification requise", "UNAUTHORIZED", 401);
      const { targetType, targetId, action } = req.body;
      const result = await UserProfileService.removeFeedback(
        req.user.id,
        targetType,
        targetId,
        action
      );
      PersonalizationEngineService.invalidateUserCache(req.user.id);
      return sendSuccess(res, result, "Préférence annulée");
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  /**
   * DELETE /api/v1/recommendations/feedback/all
   * Suppression de l'ensemble des contenus masqués / retours négatifs
   */
  static async clearAllFeedback(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Authentification requise", "UNAUTHORIZED", 401);
      const result = await UserProfileService.clearAllFeedback(req.user.id);
      PersonalizationEngineService.invalidateUserCache(req.user.id);
      return sendSuccess(res, result, "Tous les retours et masquages ont été effacés");
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  /**
   * POST /api/v1/recommendations/reset-profile
   * Réinitialisation complète du profil de goût
   */
  static async resetProfile(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Authentification requise", "UNAUTHORIZED", 401);
      const profile = await UserProfileService.resetProfile(req.user.id);
      PersonalizationEngineService.invalidateUserCache(req.user.id);
      return sendSuccess(res, profile, "Profil de recommandation réinitialisé");
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  /**
   * PATCH /api/v1/recommendations/settings
   * Active ou désactive la personnalisation
   */
  static async updateSettings(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Authentification requise", "UNAUTHORIZED", 401);
      const { personalizationActive } = req.body;
      const result = await UserProfileService.setPersonalizationActive(
        req.user.id,
        Boolean(personalizationActive)
      );
      PersonalizationEngineService.invalidateUserCache(req.user.id);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  /**
   * POST /api/v1/recommendations/onboarding
   * Finalisation de l'onboarding thématique & linguistique
   */
  static async completeOnboarding(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Authentification requise", "UNAUTHORIZED", 401);
      const { topicIds, languageCodes } = req.body;
      const profile = await UserProfileService.completeOnboarding(
        req.user.id,
        topicIds || [],
        languageCodes || []
      );
      PersonalizationEngineService.invalidateUserCache(req.user.id);
      return sendSuccess(res, profile, "Onboarding enregistré");
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  /**
   * POST /api/v1/recommendations/events/listening
   * Collecte par lots d'événements d'écoute dédupliqués
   */
  static async recordListeningEvents(req: AuthenticatedRequest, res: Response) {
    try {
      const { events } = req.body;
      if (!Array.isArray(events)) {
        return sendError(res, "events doit être un tableau", "BAD_REQUEST", 400);
      }
      const verifiedUserId = req.user?.id;
      const anonymousId = (req.headers["x-anonymous-id"] as string) || req.body.anonymousId;

      const result = await InteractionCollectorService.recordListeningEvents(
        events,
        verifiedUserId,
        anonymousId
      );
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  /**
   * POST /api/v1/recommendations/events/impressions
   * Collecte d'impressions (cartes réelles vues à l'écran)
   */
  static async recordImpressions(req: AuthenticatedRequest, res: Response) {
    try {
      const { impressions } = req.body;
      if (!Array.isArray(impressions)) {
        return sendError(res, "impressions doit être un tableau", "BAD_REQUEST", 400);
      }
      const verifiedUserId = req.user?.id;
      const anonymousId = (req.headers["x-anonymous-id"] as string) || req.body.anonymousId;

      const result = await InteractionCollectorService.recordImpressions(
        impressions,
        verifiedUserId,
        anonymousId
      );
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  /**
   * POST /api/v1/recommendations/events/interactions
   * Collecte d'interactions attribuées
   */
  static async recordInteraction(req: AuthenticatedRequest, res: Response) {
    try {
      const verifiedUserId = req.user?.id;
      const anonymousId = (req.headers["x-anonymous-id"] as string) || req.body.anonymousId;

      const ok = await InteractionCollectorService.recordInteraction(
        req.body,
        verifiedUserId,
        anonymousId
      );
      return sendSuccess(res, { recorded: ok });
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  /**
   * GET /api/v1/admin/recommendations/preview/:userId
   * Prévisualisation sécurisée et auditée pour administrateur
   */
  static async adminPreview(req: AuthenticatedRequest, res: Response) {
    try {
      const targetUserId = req.params.userId;
      const country = (req.query.country as string) || "all";

      const data = await PersonalizationEngineService.getPersonalizedHome(
        targetUserId,
        undefined,
        country
      );

      // Audit log pour la prévisualisation
      try {
        await prisma.auditLog.create({
          data: {
            actorId: req.user?.id,
            action: "RECOMMENDATION_ADMIN_PREVIEW",
            entityType: "UserRecommendationProfile",
            entityId: targetUserId,
            newState: { previewedForUser: targetUserId },
          },
        });
      } catch (_) {}

      return sendSuccess(res, data);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
