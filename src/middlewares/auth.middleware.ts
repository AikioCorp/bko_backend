import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { sendError } from "../utils/response.js";
import { JWT_SECRET } from "../config/jwt.js";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    roles: string[];
  };
}

export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return sendError(res, "Jeton d'accès manquant", "UNAUTHORIZED", 401);
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = {
      id: decoded.id,
      email: decoded.email,
      roles: decoded.roles || [],
    };
    next();
  } catch (err) {
    return sendError(res, "Jeton d'accès invalide ou expiré", "SESSION_EXPIRED", 401);
  }
};

export const optionalAuthenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (token) {
    try {
      const secret = process.env.JWT_SECRET || "bamako-podcast-super-secret-jwt-key-2026";
      const decoded = jwt.verify(token, secret) as any;
      req.user = {
        id: decoded.id,
        email: decoded.email,
        roles: decoded.roles || [],
      };
    } catch (err) {
      // Ignorer l'erreur pour les utilisateurs anonymes
    }
  }
  next();
};

export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return sendError(res, "Non authentifié", "UNAUTHORIZED", 401);
  }

  const hasAdminRole = req.user.roles.some((r) => ["ADMIN", "SUPER_ADMIN", "EDITOR"].includes(r.toUpperCase()));

  if (!hasAdminRole) {
    return sendError(res, "Accès réservé aux administrateurs de la plateforme", "FORBIDDEN", 403);
  }

  next();
};

export const requireRole = (...allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return sendError(res, "Non authentifié", "UNAUTHORIZED", 401);
    }

    const hasRole = req.user.roles.some((r) => allowedRoles.map((role) => role.toUpperCase()).includes(r.toUpperCase()));

    if (!hasRole) {
      return sendError(res, "Permissions insuffisantes pour cette opération", "FORBIDDEN", 403);
    }

    next();
  };
};
