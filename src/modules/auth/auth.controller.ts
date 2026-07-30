import { Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

export class AuthController {
  static async register(req: Request, res: Response) {
    try {
      const { email, password, fullName, phoneNumber } = req.body;
      if (!email || !password || !fullName) {
        return sendError(res, "Email, mot de passe et nom complet requis", "VALIDATION_ERROR", 400);
      }

      const result = await AuthService.register({ email, password, fullName, phoneNumber });
      return sendSuccess(res, result, null, 201);
    } catch (error: any) {
      if (error.message === "EMAIL_ALREADY_EXISTS") {
        return sendError(res, "Cet email ou numéro de téléphone est déjà utilisé", "EMAIL_ALREADY_EXISTS", 409);
      }
      return sendError(res, error.message || "Erreur lors de l'inscription");
    }
  }

  static async verifyOtp(req: Request, res: Response) {
    try {
      const { email, otpCode } = req.body;
      const result = await AuthService.verifyOtp({ email, otpCode });
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message || "Code OTP invalide ou expiré", "INVALID_CREDENTIALS", 400);
    }
  }

  static async login(req: Request, res: Response) {
    try {
      const { identifier, password, deviceType, deviceName } = req.body;
      if (!identifier || !password) {
        return sendError(res, "Identifiant et mot de passe requis", "VALIDATION_ERROR", 400);
      }

      const result = await AuthService.login({
        identifier,
        password,
        deviceType,
        deviceName,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      // Cookie HTTPOnly pour le Web
      res.cookie("refreshToken", result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, "Identifiants incorrects", "INVALID_CREDENTIALS", 401);
    }
  }

  static async refreshToken(req: Request, res: Response) {
    try {
      const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
      if (!refreshToken) {
        return sendError(res, "Refresh token manquant", "UNAUTHORIZED", 401);
      }

      const result = await AuthService.refreshToken(refreshToken);

      res.cookie("refreshToken", result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, "Refresh token invalide ou expiré", "INVALID_REFRESH_TOKEN", 401);
    }
  }

  static async logout(req: Request, res: Response) {
    try {
      const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
      if (refreshToken) {
        await AuthService.logout(refreshToken);
      }
      res.clearCookie("refreshToken");
      return sendSuccess(res, { message: "Déconnexion réussie" });
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async logoutAllDevices(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const result = await AuthService.logoutAllDevices(req.user.id);
      res.clearCookie("refreshToken");
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
