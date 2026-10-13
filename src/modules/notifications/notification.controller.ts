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

  static async registerPushToken(req: AuthenticatedRequest, res: Response) {
    try {
      const { PushNotificationService } = await import("../../services/push-notification.service.js");
      const schema = z.object({
        token: z.string().min(10),
        deviceType: z.enum(["ANDROID", "IOS", "WEB"]).default("ANDROID"),
        deviceName: z.string().optional(),
      });
      const data = schema.parse(req.body);
      const ok = await PushNotificationService.registerToken({
        userId: req.user!.id,
        token: data.token,
        deviceType: data.deviceType,
        deviceName: data.deviceName,
      });
      return sendSuccess(res, { registered: ok });
    } catch (e) {
      return fail(res, e);
    }
  }

  static async unregisterPushToken(req: AuthenticatedRequest, res: Response) {
    try {
      const { PushNotificationService } = await import("../../services/push-notification.service.js");
      const schema = z.object({
        token: z.string().min(10),
      });
      const data = schema.parse(req.body);
      await PushNotificationService.unregisterToken(data.token);
      return sendSuccess(res, { unregistered: true });
    } catch (e) {
      return fail(res, e);
    }
  }
}
