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

  static async revokeAllOtherDevices(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const currentDeviceId = typeof req.body?.currentDeviceId === "string" ? req.body.currentDeviceId : undefined;
      const result = await UserService.revokeAllOtherDevices(req.user.id, currentDeviceId);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async changePassword(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const result = await UserService.changePassword(req.user.id, req.body);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors du changement de mot de passe", "VALIDATION_ERROR", 400);
    }
  }

  static async exportData(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const data = await UserService.exportData(req.user.id);
      return sendSuccess(res, data);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async deleteAccount(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const passwordConfirm = typeof req.body?.passwordConfirm === "string" ? req.body.passwordConfirm : undefined;
      const result = await UserService.deleteAccount(req.user.id, passwordConfirm);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message, "VALIDATION_ERROR", 400);
    }
  }

  static async submitSupportTicket(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { subject, category, description, appVersion, osVersion } = req.body;
      if (!subject || !description) {
        return sendError(res, "Le sujet et la description sont requis.", "VALIDATION_ERROR", 400);
      }
      const ticket = await UserService.submitSupportTicket(req.user.id, {
        subject: String(subject),
        category: category ? String(category) : undefined,
        description: String(description),
        appVersion: appVersion ? String(appVersion) : undefined,
        osVersion: osVersion ? String(osVersion) : undefined,
      });
      return sendSuccess(res, ticket, null, 201);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async uploadAvatar(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { imageBase64, mimeType } = req.body;
      if (!imageBase64) {
        return sendError(res, "Image manquante", "VALIDATION_ERROR", 400);
      }
      const result = await UserService.uploadAvatar(req.user.id, {
        imageBase64: String(imageBase64),
        mimeType: mimeType ? String(mimeType) : undefined,
      });
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message, "VALIDATION_ERROR", 400);
    }
  }
}
