import { Response, NextFunction } from "express";
import { sendError } from "../utils/response.js";
import { AuthenticatedRequest } from "./auth.middleware.js";
import { PermissionService } from "../services/permission.service.js";

/**
 * Exige TOUTES les permissions listées (ex. requirePermission("catalog.view")).
 * Les droits sont lus en base (cache court) et non dans le JWT : un retrait d'accès
 * s'applique en quelques secondes, sans attendre l'expiration du token.
 */
export const requirePermission = (...required: string[]) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return sendError(res, "Non authentifié", "UNAUTHORIZED", 401);
    try {
      const access = await PermissionService.getAccess(req.user.id);
      if (!required.every((p) => access.permissions.has(p))) {
        return sendError(res, "Vous n'avez pas accès à cette fonctionnalité", "FORBIDDEN", 403);
      }
      next();
    } catch (e) {
      console.error("[permission]", e);
      return sendError(res, "Une erreur inattendue est survenue.");
    }
  };
};
