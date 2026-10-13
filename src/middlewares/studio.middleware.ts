import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./auth.middleware.js";
import { CreatorProfileService } from "../modules/creator/creator-profile.service.js";
import { creatorError } from "../utils/creator-errors.js";
import { sendError } from "../utils/response.js";

export async function requireStudioAccess(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
    const access = await CreatorProfileService.getStudioAccess(req.user.id);
    if (!access.canAccess) return sendError(res, "Activez votre Studio pour continuer.", "CREATOR_PROFILE_REQUIRED", 403);
    next();
  } catch (error) { return creatorError(res, error); }
}
