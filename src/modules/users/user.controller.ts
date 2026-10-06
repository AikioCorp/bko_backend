import { Response } from "express";
import { UserService } from "./user.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

export class UserController {
  static async getMe(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const profile = await UserService.getMe(req.user.id);
      return sendSuccess(res, profile);
    } catch (error: any) {
      console.error("[UserController.getMe] Error:", error);
      return sendError(res, error.message || "Erreur lors de la récupération du profil.");
    }
  }

  static async updateMe(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const updated = await UserService.updateMe(req.user.id, req.body);
      return sendSuccess(res, updated);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async updatePreferences(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const updated = await UserService.updatePreferences(req.user.id, req.body);
      return sendSuccess(res, updated);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getDevices(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const devices = await UserService.getDevices(req.user.id);
      return sendSuccess(res, devices);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async revokeDevice(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const result = await UserService.revokeDevice(req.user.id, req.params.id);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
