import { Request, Response } from "express";
import { z } from "zod";
import { SubscriptionService } from "./subscription.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

const checkoutSchema = z.object({
  planId: z.string().min(1, "Formule requise"),
  paymentMethod: z.enum(["ORANGE_MONEY", "WAVE", "MOOV_MONEY", "CARD"]),
  phoneNumber: z.string().min(8).max(20).optional(),
  autoRenew: z.boolean().default(true),
});

const buyEpisodeSchema = z.object({
  episodeId: z.string().min(1, "Épisode requis"),
  paymentMethod: z.enum(["ORANGE_MONEY", "WAVE", "MOOV_MONEY", "CARD"]),
  phoneNumber: z.string().min(8).max(20).optional(),
});

export class SubscriptionController {
  static async listPlans(_req: Request, res: Response) {
    try {
      const plans = await SubscriptionService.listPlans();
      return sendSuccess(res, plans);
    } catch (error: any) {
      return sendError(res, error.message || "Impossible de récupérer les formules");
    }
  }

  static async getMySubscription(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Authentification requise", "UNAUTHORIZED", 401);
      const data = await SubscriptionService.getUserSubscription(req.user.id);
      return sendSuccess(res, data);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async checkout(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Authentification requise", "UNAUTHORIZED", 401);
      const parsed = checkoutSchema.parse(req.body);
      const result = await SubscriptionService.checkout(req.user.id, parsed, req.ip);
      return sendSuccess(res, result, null, 201);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return sendError(res, "Données invalides", "VALIDATION_ERROR", 400, error.flatten().fieldErrors);
      }
      return sendError(res, error.message || "Erreur lors du paiement");
    }
  }

  static async buyEpisode(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Authentification requise", "UNAUTHORIZED", 401);
      const parsed = buyEpisodeSchema.parse(req.body);
      const result = await SubscriptionService.buyEpisode(req.user.id, parsed, req.ip);
      return sendSuccess(res, result, null, 201);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return sendError(res, "Données invalides", "VALIDATION_ERROR", 400, error.flatten().fieldErrors);
      }
      return sendError(res, error.message || "Erreur lors de l'achat de l'épisode");
    }
  }

  static async cancelSubscription(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Authentification requise", "UNAUTHORIZED", 401);
      const { subscriptionId } = req.body;
      if (!subscriptionId) return sendError(res, "Identifiant d'abonnement requis", "MISSING_ID", 400);
      const result = await SubscriptionService.cancelSubscription(req.user.id, subscriptionId, req.ip);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async checkEpisodeAccess(req: Request, res: Response) {
    try {
      const episodeId = req.params.id;
      const userId = (req as AuthenticatedRequest).user?.id;
      const access = await SubscriptionService.checkEpisodeAccess(userId, episodeId);
      return sendSuccess(res, access);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  // =========================================================================
  // ADMIN CONTROLLER ENDPOINTS
  // =========================================================================

  static async adminListPlans(_req: Request, res: Response) {
    try {
      const plans = await SubscriptionService.adminListPlans();
      return sendSuccess(res, plans);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors du chargement des formules admin");
    }
  }

  static async adminCreatePlan(req: AuthenticatedRequest, res: Response) {
    try {
      const plan = await SubscriptionService.adminCreatePlan(req.body);
      return sendSuccess(res, plan, null, 201);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la création de la formule");
    }
  }

  static async adminUpdatePlan(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const plan = await SubscriptionService.adminUpdatePlan(id, req.body);
      return sendSuccess(res, plan);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la mise à jour de la formule");
    }
  }

  static async adminTogglePlan(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const plan = await SubscriptionService.adminTogglePlan(id);
      return sendSuccess(res, plan);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors du changement de visibilité");
    }
  }

  static async adminDeletePlan(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      await SubscriptionService.adminDeletePlan(id);
      return sendSuccess(res, { deleted: true, id });
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la suppression de la formule");
    }
  }
}
