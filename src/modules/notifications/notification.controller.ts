import { Response } from "express";
import { z } from "zod";
import { NotificationService } from "../../services/notification.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

const fail = (res: Response, e: unknown) => {
  if (e instanceof z.ZodError) return sendError(res, "Données invalides", "VALIDATION_ERROR", 400);
  console.error("[notifications]", e);
  return sendError(res, "Une erreur inattendue est survenue.");
};

export class NotificationController {
  static async list(req: AuthenticatedRequest, res: Response) {
    try {
      const q = z
        .object({ limit: z.coerce.number().int().min(1).max(50).default(20), before: z.string().datetime().optional() })
        .parse(req.query);
      return sendSuccess(res, await NotificationService.list(req.user!.id, q.limit, q.before));
    } catch (e) {
      return fail(res, e);
    }
  }

  static async unreadCount(req: AuthenticatedRequest, res: Response) {
    try {
      return sendSuccess(res, { unread: await NotificationService.unreadCount(req.user!.id) });
    } catch (e) {
      return fail(res, e);
    }
  }

  static async markRead(req: AuthenticatedRequest, res: Response) {
    try {
      const b = z.object({ ids: z.array(z.string().min(1).max(64)).max(100).optional() }).parse(req.body ?? {});
      return sendSuccess(res, await NotificationService.markRead(req.user!.id, b.ids));
    } catch (e) {
      return fail(res, e);
    }
  }
}
