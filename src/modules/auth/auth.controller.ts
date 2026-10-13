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
      if (typeof password !== "string" || password.length < 8 || password.length > 72) {
        return sendError(res, "Le mot de passe doit contenir entre 8 et 72 caractères", "VALIDATION_ERROR", 400);
      }
      if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return sendError(res, "Adresse email invalide", "VALIDATION_ERROR", 400);
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

  static async forgotPassword(req: Request, res: Response) {
    try {
      const email = String(req.body?.email ?? "").trim();
      if (!email.includes("@") || email.length > 254) {
        return sendError(res, "Adresse email invalide", "VALIDATION_ERROR", 400);
      }
      return sendSuccess(res, await AuthService.forgotPassword(email));
    } catch (error: any) {
      console.error("[auth] forgotPassword", error);
      return sendError(res, "Une erreur inattendue est survenue.");
    }
  }

  static async verifyResetOtp(req: Request, res: Response) {
    try {
      const email = String(req.body?.email ?? "").trim();
      const otpCode = String(req.body?.otpCode ?? "").trim();
      if (!email || !otpCode) {
        return sendError(res, "Email et code OTP requis", "VALIDATION_ERROR", 400);
      }
      const result = await AuthService.verifyResetOtp(email, otpCode);
      return sendSuccess(res, result);
    } catch (error: any) {
      if (error.message === "RESET_CODE_INVALID") {
        return sendError(res, "Code de réinitialisation incorrect ou expiré", "RESET_CODE_INVALID", 400);
      }
      return sendError(res, "Code de vérification invalide", "VALIDATION_ERROR", 400);
    }
  }

  static async resetPassword(req: Request, res: Response) {
    try {
      const token = req.body?.token ? String(req.body.token) : undefined;
      const email = req.body?.email ? String(req.body.email).trim() : undefined;
      const otpCode = req.body?.otpCode ? String(req.body.otpCode).trim() : undefined;
      const password = String(req.body?.password ?? "");

      if (!token && (!email || !otpCode)) {
        return sendError(res, "Code OTP ou lien de réinitialisation requis", "VALIDATION_ERROR", 400);
      }
      if (password.length < 8 || password.length > 72) {
        return sendError(res, "Le mot de passe doit contenir entre 8 et 72 caractères", "VALIDATION_ERROR", 400);
      }

      const result = await AuthService.resetPassword({ token, email, otpCode, password });
      return sendSuccess(res, result);
    } catch (error: any) {
      if (error.message === "RESET_TOKEN_INVALID" || error.message === "RESET_CODE_INVALID") {
        return sendError(res, "Code ou lien invalide ou expiré", "RESET_TOKEN_INVALID", 400);
      }
      console.error("[auth] resetPassword", error);
      return sendError(res, "Une erreur inattendue est survenue.");
    }
  }

  static async resendOtp(req: Request, res: Response) {
    try {
      const email = String(req.body?.email ?? "").trim();
      if (!email || !email.includes("@")) {
        return sendError(res, "Adresse email requise", "VALIDATION_ERROR", 400);
      }
      const result = await AuthService.resendOtp(email);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors du renvoi du code", "INTERNAL_ERROR", 500);
    }
  }

  static async verifyOtp(req: Request, res: Response) {
    try {
      const { email, otpCode, deviceType, deviceName } = req.body;
      if (!email || !otpCode) {
        return sendError(res, "Email et code OTP requis", "VALIDATION_ERROR", 400);
      }
      const result = await AuthService.verifyOtp({
        email,
        otpCode,
        deviceType,
        deviceName,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      // Cookie HTTPOnly pour le Web
      if (result.refreshToken) {
        res.cookie("refreshToken", result.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });
      }

      return sendSuccess(res, result);
    } catch (error: any) {
      if (error.code === "ACCOUNT_SUSPENDED" || error.name === "AccountSuspendedError") {
        return sendError(res, error.message || "Votre compte a été suspendu.", "ACCOUNT_SUSPENDED", 403, error.details);
      }
      if (error.message === "RESET_TOKEN_EXPIRED") {
        return sendError(res, "Le code de vérification a expiré", "OTP_EXPIRED", 400);
      }
      return sendError(res, "Code de vérification incorrect ou expiré", "INVALID_CREDENTIALS", 400);
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
      if (error.code === "ACCOUNT_SUSPENDED" || error.name === "AccountSuspendedError") {
        return sendError(res, error.message || "Votre compte a été suspendu.", "ACCOUNT_SUSPENDED", 403, error.details);
      }
      if (error.message === "ACCOUNT_NOT_VERIFIED") {
        return sendError(res, "Compte non vérifié. Veuillez confirmer le code OTP envoyé.", "ACCOUNT_NOT_VERIFIED", 403);
      }
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
      if (error.code === "ACCOUNT_SUSPENDED" || error.name === "AccountSuspendedError") {
        return sendError(res, error.message || "Votre compte a été suspendu.", "ACCOUNT_SUSPENDED", 403, error.details);
      }
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

  static async googleLogin(req: Request, res: Response) {
    try {
      const { idToken, deviceType, deviceName } = req.body;
      if (!idToken) {
        return sendError(res, "Jeton Google (idToken) requis", "VALIDATION_ERROR", 400);
      }

      const result = await AuthService.loginWithGoogle({
        idToken,
        deviceType: deviceType || "WEB",
        deviceName: deviceName || "Navigateur Web",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      res.cookie("refreshToken", result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      return sendSuccess(res, result);
    } catch (error: any) {
      console.error("[auth] Erreur Google Login:", error.message);
      if (error.code === "ACCOUNT_SUSPENDED" || error.message === "ACCOUNT_SUSPENDED") {
        return sendError(res, error.message || "Ce compte a été suspendu par l'administration", "ACCOUNT_SUSPENDED", 403, error.details);
      }
      return sendError(res, error.message || "Échec de l'authentification Google", "GOOGLE_AUTH_ERROR", 401);
    }
  }

  static async requestOtpLogin(req: Request, res: Response) {
    try {
      const identifier = String(req.body?.identifier || req.body?.email || "").trim();
      if (!identifier) {
        return sendError(res, "Adresse email ou numéro de téléphone requis", "VALIDATION_ERROR", 400);
      }
      const result = await AuthService.requestOtpLogin(identifier);
      return sendSuccess(res, result);
    } catch (error: any) {
      if (error.code === "ACCOUNT_SUSPENDED" || error.message === "ACCOUNT_SUSPENDED") {
        return sendError(res, error.message || "Ce compte est suspendu", "ACCOUNT_SUSPENDED", 403, error.details);
      }
      if (error.message === "USER_NOT_FOUND") {
        return sendError(res, "Aucun compte associé à cet identifiant", "USER_NOT_FOUND", 404);
      }
      return sendError(res, error.message || "Erreur lors de l'envoi du code de connexion");
    }
  }

  static async verifyOtpLogin(req: Request, res: Response) {
    try {
      const identifier = String(req.body?.identifier || req.body?.email || "").trim();
      const otpCode = String(req.body?.otpCode || req.body?.code || "").trim();
      const { deviceType, deviceName } = req.body;

      if (!identifier || !otpCode) {
        return sendError(res, "Identifiant et code de vérification requis", "VALIDATION_ERROR", 400);
      }

      const result = await AuthService.verifyOtpLogin({
        identifier,
        otpCode,
        deviceType,
        deviceName,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      res.cookie("refreshToken", result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      return sendSuccess(res, result);
    } catch (error: any) {
      if (error.code === "ACCOUNT_SUSPENDED" || error.message === "ACCOUNT_SUSPENDED") {
        return sendError(res, error.message || "Ce compte est suspendu", "ACCOUNT_SUSPENDED", 403, error.details);
      }
      if (error.message === "INVALID_CREDENTIALS") {
        return sendError(res, "Code de vérification invalide ou expiré", "INVALID_CREDENTIALS", 400);
      }
      if (error.message === "RESET_TOKEN_EXPIRED") {
        return sendError(res, "Ce code de vérification a expiré", "RESET_TOKEN_EXPIRED", 400);
      }
      return sendError(res, error.message || "Erreur lors de la connexion");
    }
  }
}
