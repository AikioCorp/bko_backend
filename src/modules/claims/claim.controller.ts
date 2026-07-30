import { Response } from "express";
import { ClaimService } from "./claim.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

export class ClaimController {
  static async submitClaim(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const claim = await ClaimService.submitClaim(req.user.id, {
        podcastId: req.params.podcastId,
        proofDescription: req.body.proofDescription,
        proofDocumentUrl: req.body.proofDocumentUrl,
        verificationMethod: req.body.verificationMethod,
      });
      return sendSuccess(res, claim, null, 201);
    } catch (error: any) {
      if (error.message === "CLAIM_ALREADY_SUBMITTED") {
        return sendError(res, "Vous avez déjà une demande de revendication en cours pour ce podcast", "CLAIM_ALREADY_SUBMITTED", 400);
      }
      return sendError(res, error.message);
    }
  }

  static async getUserClaims(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const claims = await ClaimService.getUserClaims(req.user.id);
      return sendSuccess(res, claims);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getAdminClaims(req: AuthenticatedRequest, res: Response) {
    try {
      const claims = await ClaimService.getAdminClaims(req.query.status as any);
      return sendSuccess(res, claims);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async reviewClaim(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { status, reviewNotes } = req.body;
      const updated = await ClaimService.reviewClaim(req.user.id, req.params.id, status, reviewNotes);
      return sendSuccess(res, updated);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
