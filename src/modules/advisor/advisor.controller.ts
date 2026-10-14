import { Response } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AdvisorService } from "./advisor.service.js";
import { prisma } from "../../config/prisma.js";

export class AdvisorController {
  /**
   * POST /api/v1/advisor/chat
   * Route publique & optionnellement authentifiée.
   * L'identité est résolue et vérifiée côté serveur uniquement.
   */
  static async chat(req: AuthenticatedRequest, res: Response) {
    try {
      const { chatInput, sessionId } = req.body;

      if (!chatInput || typeof chatInput !== "string" || chatInput.trim().length === 0) {
        return sendError(res, "Le message chatInput est requis.", "INVALID_INPUT", 400);
      }

      const activeSessionId = sessionId || (req.user ? `user_${req.user.id}` : "guest_session");

      // Si l'utilisateur est authentifié, on récupère son vrai prénom vérifié en base
      let firstName = undefined;
      let context = undefined;

      if (req.user?.id) {
        const user = await prisma.user.findUnique({
          where: { id: req.user.id },
          select: { fullName: true },
        });

        if (user?.fullName) {
          firstName = user.fullName.trim().split(" ")[0];
        }

        // Récupérer le contexte d'écoute (historique et dernier épisode interrompu)
        context = await AdvisorService.getListeningContext(req.user.id);
      }

      // Transmission sécurisée vers n8n
      const result = await AdvisorService.forwardToN8n({
        sessionId: activeSessionId,
        chatInput: chatInput.trim(),
        userId: req.user?.id,
        firstName,
        context,
      });

      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la communication avec Ali.", "ADVISOR_ERROR", 500);
    }
  }

  /**
   * GET /api/v1/advisor/listening-context
   * Retourne l'historique d'écoute de l'utilisateur authentifié.
   */
  static async getListeningContext(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user?.id) {
        return sendError(res, "Authentification requise.", "UNAUTHORIZED", 401);
      }

      const context = await AdvisorService.getListeningContext(req.user.id);
      return sendSuccess(res, context);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  /**
   * POST /api/v1/advisor/favorites
   * Ajoute un épisode aux favoris de manière idempotente pour l'utilisateur authentifié.
   */
  static async addFavorite(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user?.id) {
        return sendError(
          res,
          "Pour ajouter cet épisode à tes favoris, connecte-toi ou crée ton compte dans l'onglet Profil !",
          "UNAUTHORIZED",
          401
        );
      }

      const { episodeTitleOrSlug } = req.body;
      if (!episodeTitleOrSlug) {
        return sendError(res, "Le paramètre episodeTitleOrSlug est requis.", "INVALID_INPUT", 400);
      }

      const result = await AdvisorService.addFavorite(req.user.id, episodeTitleOrSlug);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  /**
   * Endpoint interne M2M pour que n8n puisse exécuter des actions vérifiées
   * Header requis : x-automation-secret
   */
  static async handleM2mAction(req: any, res: Response) {
    try {
      const secret = process.env.AUTOMATION_SECRET || process.env.JWT_SECRET;
      const providedSecret = req.headers["x-automation-secret"];

      if (!secret || providedSecret !== secret) {
        return sendError(res, "Accès réservé au système d'automatisation.", "UNAUTHORIZED", 403);
      }

      const { action, userId, term } = req.body;

      if (!userId) {
        return sendError(res, "userId requis pour l'action M2M.", "INVALID_INPUT", 400);
      }

      if (action === "ADD_FAVORITE") {
        const result = await AdvisorService.addFavorite(userId, term);
        return sendSuccess(res, result);
      }

      if (action === "GET_LISTENING_CONTEXT") {
        const result = await AdvisorService.getListeningContext(userId);
        return sendSuccess(res, result);
      }

      return sendError(res, "Action inconnue.", "INVALID_ACTION", 400);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
