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

import { prisma } from "../config/prisma.js";

interface CachedAccountStatus {
  isSuspended: boolean;
  suspendedReason?: string | null;
  suspendedAt?: Date | null;
  fullName?: string;
  email?: string;
  avatar?: string | null;
  cachedAt: number;
}

const statusCache = new Map<string, CachedAccountStatus>();
const STATUS_CACHE_TTL = 10_000; // 10 secondes

export function invalidateAccountStatusCache(userId?: string) {
  if (userId) {
    statusCache.delete(userId);
  } else {
    statusCache.clear();
  }
}

export async function checkUserSuspended(userId: string): Promise<Omit<CachedAccountStatus, "cachedAt">> {
  const cached = statusCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < STATUS_CACHE_TTL) {
    return cached;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isSuspended: true,
      suspendedReason: true,
      suspendedAt: true,
      fullName: true,
      email: true,
      avatar: true,
    },
  });
  if (!user) {
    return { isSuspended: false };
  }
  const entry: CachedAccountStatus = {
    isSuspended: user.isSuspended,
    suspendedReason: user.suspendedReason,
    suspendedAt: user.suspendedAt,
    fullName: user.fullName,
    email: user.email,
    avatar: user.avatar,
    cachedAt: Date.now(),
  };
  statusCache.set(userId, entry);
  return entry;
}

export const authenticateToken = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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

    // Contrôle réel côté serveur du statut du compte (suspension / blocage)
    const status = await checkUserSuspended(decoded.id);
    if (status.isSuspended) {
      let supportToken: string | undefined;
      try {
        supportToken = jwt.sign(
          { id: decoded.id, email: status.email || decoded.email, roles: [], isSuspended: true },
          JWT_SECRET,
          { expiresIn: "7d" }
        );
      } catch (_) {}

      return sendError(
        res,
        status.suspendedReason || "Votre compte a été suspendu par l'administration.",
        "ACCOUNT_SUSPENDED",
        403,
        {
          reason: status.suspendedReason || "Compte suspendu par l'administration",
          isPermanent: true,
          suspendedAt: status.suspendedAt ? status.suspendedAt.toISOString() : undefined,
          userId: decoded.id,
          email: status.email || decoded.email,
          fullName: status.fullName,
          avatar: status.avatar,
          supportToken,
        }
      );
    }

    next();
  } catch (err: any) {
    if (err?.code === "ACCOUNT_SUSPENDED") {
      return sendError(res, err.message, "ACCOUNT_SUSPENDED", 403, err.details);
    }
    return sendError(res, "Jeton d'accès invalide ou expiré", "SESSION_EXPIRED", 401);
  }
};

export const optionalAuthenticateToken = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const status = await checkUserSuspended(decoded.id);
      if (!status.isSuspended) {
        req.user = {
          id: decoded.id,
          email: decoded.email,
          roles: decoded.roles || [],
        };
      }
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
