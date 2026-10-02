import { Response } from "express";
import { z } from "zod";
import { AdminConsoleService } from "./admin-console.service.js";
import { AdminRbacService } from "./admin-rbac.service.js";
import { PermissionService } from "../../services/permission.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

// Erreurs métier → (code HTTP, message). Tout le reste est une 500 générique.
const KNOWN: Record<string, [number, string]> = {
  NOT_FOUND: [404, "Ressource introuvable"],
  FORBIDDEN: [403, "Permissions insuffisantes pour cette opération"],
  NOT_PENDING_REVIEW: [409, "Ce contenu n'est pas en attente de validation"],
  REVIEW_NOTE_REQUIRED: [400, "Un motif est requis pour refuser un contenu"],
  REPORT_ALREADY_OPEN: [409, "Vous avez déjà un signalement en cours pour ce contenu"],
  ACTION_NOT_SUPPORTED_FOR_TARGET: [400, "Cette action n'est pas disponible pour ce type de cible"],
  CANNOT_DEMOTE_SELF: [400, "Vous ne pouvez pas retirer vos propres droits d'administration"],
  CANNOT_SUSPEND_SELF: [400, "Vous ne pouvez pas suspendre votre propre compte"],
  UNKNOWN_ROLE: [400, "Rôle inconnu"],
  UNKNOWN_PERMISSION: [400, "Permission inconnue"],
  INVALID_ROLE_NAME: [400, "Nom de rôle invalide (3 à 40 caractères : lettres, chiffres, _)"],
  ROLE_EXISTS: [409, "Un rôle porte déjà ce nom"],
  PERMISSION_ESCALATION: [403, "Vous ne pouvez pas accorder des droits que vous ne possédez pas"],
  SUPER_ADMIN_LOCKED: [403, "Le rôle SUPER_ADMIN ne peut pas être modifié"],
  SYSTEM_ROLE_LOCKED: [403, "Ce rôle système ne peut pas être supprimé"],
  ROLE_IN_USE: [409, "Ce rôle est encore attribué à des utilisateurs"],
  CANNOT_EDIT_SELF: [400, "Vous ne pouvez pas modifier vos propres rôles"],
  CANNOT_LOCK_YOURSELF_OUT: [400, "Vous ne pouvez pas vous retirer la gestion des rôles"],
  REASON_REQUIRED: [400, "Un motif est requis pour suspendre un compte"],
  CREATOR_PROFILE_NOT_FOUND: [404, "Cet utilisateur n'a pas de profil créateur"],
  JOB_NOT_FOUND: [404, "Tâche introuvable"],
  JOB_NOT_FAILED: [409, "Seules les tâches en échec peuvent être relancées"],
};

function fail(res: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    return sendError(res, "Données invalides", "VALIDATION_ERROR", 400, error.flatten().fieldErrors);
  }
  const code = error instanceof Error ? error.message : "";
  const known = KNOWN[code];
  if (known) return sendError(res, known[1], code, known[0]);
  console.error("[admin-console]", error);
  return sendError(res, "Une erreur inattendue est survenue.");
}

const REPORT_REASONS = ["COPYRIGHT", "INAPPROPRIATE", "SPAM", "IMPERSONATION", "MISINFORMATION", "OTHER"] as const;
const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);
const decision = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().max(2000).optional() });
const actor = (req: AuthenticatedRequest) => req.user!;
const idParam = (req: AuthenticatedRequest) => z.string().min(1).max(64).parse(req.params.id);

export class AdminConsoleController {
  static async overview(_req: AuthenticatedRequest, res: Response) {
    try {
      const data = await AdminConsoleService.getOverview();
      const access = await PermissionService.getAccess(_req.user!.id);
      if (!access.permissions.has("audit.view")) data.recentAudit = [];
      if (!access.permissions.has("moderation.view")) data.reportsByReason = [];
      return sendSuccess(res, data);
    } catch (e) {
      return fail(res, e);
    }
  }

  static async reviewQueue(_req: AuthenticatedRequest, res: Response) {
    try {
      return sendSuccess(res, await AdminConsoleService.listReviewQueue());
    } catch (e) {
      return fail(res, e);
    }
  }

  static async reviewEpisode(req: AuthenticatedRequest, res: Response) {
    try {
      const b = decision.parse(req.body);
      return sendSuccess(res, await AdminConsoleService.reviewEpisode(actor(req).id, idParam(req), b.decision, b.note, req.ip));
    } catch (e) {
      return fail(res, e);
    }
  }

  static async reviewPodcast(req: AuthenticatedRequest, res: Response) {
    try {
      const b = decision.parse(req.body);
      return sendSuccess(res, await AdminConsoleService.reviewPodcast(actor(req).id, idParam(req), b.decision, b.note, req.ip));
    } catch (e) {
      return fail(res, e);
    }
  }

  // Signalement public (utilisateur connecté)
  static async createReport(req: AuthenticatedRequest, res: Response) {
    try {
      const b = z
        .object({
          targetType: z.enum(["PODCAST", "EPISODE", "PERSON", "COMMENT", "CREATOR_PROFILE"]),
          targetId: z.string().min(1).max(64),
          reason: z.enum(REPORT_REASONS),
          description: z.string().max(2000).optional(),
        })
        .parse(req.body);
      const r = await AdminConsoleService.createReport(actor(req).id, b);
      return sendSuccess(res, { id: r.id, status: r.status }, null, 201);
    } catch (e) {
      return fail(res, e);
    }
  }

  static async listReports(req: AuthenticatedRequest, res: Response) {
    try {
      const q = z
        .object({
          status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED", "DISMISSED"]).optional(),
          reason: z.enum(REPORT_REASONS).optional(),
          page,
          limit,
        })
        .parse(req.query);
      return sendSuccess(res, await AdminConsoleService.listReports(q));
    } catch (e) {
      return fail(res, e);
    }
  }

  static async handleReport(req: AuthenticatedRequest, res: Response) {
    try {
      const b = z
        .object({
          status: z.enum(["IN_REVIEW", "RESOLVED", "REJECTED", "DISMISSED"]),
          note: z.string().max(2000).optional(),
          action: z.literal("SUSPEND_TARGET").optional(),
        })
        .parse(req.body);
      return sendSuccess(res, await AdminConsoleService.handleReport(actor(req).id, idParam(req), b, req.ip));
    } catch (e) {
      return fail(res, e);
    }
  }

  static async listUsers(req: AuthenticatedRequest, res: Response) {
    try {
      const q = z
        .object({ search: z.string().max(100).optional(), role: z.string().max(40).optional(), page, limit })
        .parse(req.query);
      return sendSuccess(res, await AdminConsoleService.listUsers(q));
    } catch (e) {
      return fail(res, e);
    }
  }

  static async myAccess(req: AuthenticatedRequest, res: Response) {
    try {
      return sendSuccess(res, await AdminRbacService.getMyAccess(actor(req).id));
    } catch (e) {
      return fail(res, e);
    }
  }

  static async permissionsCatalog(_req: AuthenticatedRequest, res: Response) {
    try {
      return sendSuccess(res, AdminRbacService.getCatalog());
    } catch (e) {
      return fail(res, e);
    }
  }

  static async listRoles(_req: AuthenticatedRequest, res: Response) {
    try {
      return sendSuccess(res, await AdminRbacService.listRoles());
    } catch (e) {
      return fail(res, e);
    }
  }

  static async assignableRoles(req: AuthenticatedRequest, res: Response) {
    try {
      return sendSuccess(res, await AdminRbacService.listAssignableRoles(actor(req).id));
    } catch (e) {
      return fail(res, e);
    }
  }

  static async createRole(req: AuthenticatedRequest, res: Response) {
    try {
      const b = z
        .object({ name: z.string().min(3).max(60), description: z.string().max(120).optional(), permissions: z.array(z.string().max(60)).max(100) })
        .parse(req.body);
      return sendSuccess(res, await AdminRbacService.createRole(actor(req), b, req.ip), null, 201);
    } catch (e) {
      return fail(res, e);
    }
  }

  static async updateRole(req: AuthenticatedRequest, res: Response) {
    try {
      const b = z.object({ description: z.string().max(120).optional(), permissions: z.array(z.string().max(60)).max(100) }).parse(req.body);
      return sendSuccess(res, await AdminRbacService.updateRole(actor(req), idParam(req), b, req.ip));
    } catch (e) {
      return fail(res, e);
    }
  }

  static async deleteRole(req: AuthenticatedRequest, res: Response) {
    try {
      return sendSuccess(res, await AdminRbacService.deleteRole(actor(req), idParam(req), req.ip));
    } catch (e) {
      return fail(res, e);
    }
  }

  static async setUserRoles(req: AuthenticatedRequest, res: Response) {
    try {
      const b = z.object({ roles: z.array(z.string().min(1).max(40)).min(1).max(10) }).parse(req.body);
      return sendSuccess(res, await AdminRbacService.setUserRoles(actor(req), idParam(req), b.roles, req.ip));
    } catch (e) {
      return fail(res, e);
    }
  }

  static async setUserSuspension(req: AuthenticatedRequest, res: Response) {
    try {
      const b = z.object({ suspended: z.boolean(), reason: z.string().max(500).optional() }).parse(req.body);
      return sendSuccess(res, await AdminRbacService.setUserSuspension(actor(req), idParam(req), b.suspended, b.reason, req.ip));
    } catch (e) {
      return fail(res, e);
    }
  }

  static async setCreatorVerification(req: AuthenticatedRequest, res: Response) {
    try {
      const b = z.object({ verified: z.boolean() }).parse(req.body);
      return sendSuccess(res, await AdminConsoleService.setCreatorVerification(actor(req).id, idParam(req), b.verified, req.ip));
    } catch (e) {
      return fail(res, e);
    }
  }

  static async storage(_req: AuthenticatedRequest, res: Response) {
    try {
      return sendSuccess(res, await AdminConsoleService.getStorageOverview());
    } catch (e) {
      return fail(res, e);
    }
  }

  static async retryJob(req: AuthenticatedRequest, res: Response) {
    try {
      return sendSuccess(res, await AdminConsoleService.retryJob(actor(req).id, idParam(req), req.ip));
    } catch (e) {
      return fail(res, e);
    }
  }

  static async settings(_req: AuthenticatedRequest, res: Response) {
    try {
      return sendSuccess(res, AdminConsoleService.getSettings());
    } catch (e) {
      return fail(res, e);
    }
  }
}
