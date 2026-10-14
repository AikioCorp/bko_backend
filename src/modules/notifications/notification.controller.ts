import { Response } from "express";
import { z } from "zod";
import { NotificationService } from "../../services/notification.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

import { prisma } from "../../config/prisma.js";

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

  static async delete(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id;
      if (!id) return sendError(res, "Identifiant requis", "BAD_REQUEST", 400);
      return sendSuccess(res, await NotificationService.delete(req.user!.id, id));
    } catch (e) {
      return fail(res, e);
    }
  }

  static async clearAll(req: AuthenticatedRequest, res: Response) {
    try {
      return sendSuccess(res, await NotificationService.clearAll(req.user!.id));
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
      await PushNotificationService.unregisterToken(data.token, req.user!.id);
      return sendSuccess(res, { unregistered: true });
    } catch (e) {
      return fail(res, e);
    }
  }

  /**
   * Endpoint d'envoi de campagne de notifications & emails marketing (utilisable par n8n ou admin)
   * Authentification : Soit header 'x-automation-secret', soit JWT d'un administrateur.
   */
  static async sendCampaign(req: any, res: Response) {
    try {
      const secret = process.env.AUTOMATION_SECRET || process.env.JWT_SECRET;
      const providedSecret = req.headers["x-automation-secret"];
      const user = req.user;
      const isAuthorized =
        (secret && providedSecret === secret) ||
        (user && (user.role === "ADMIN" || user.role === "SUPER_ADMIN"));

      if (!isAuthorized) {
        return sendError(res, "Accès réservé au système d'automatisation ou aux administrateurs.", "UNAUTHORIZED", 403);
      }

      const schema = z.object({
        userIds: z.array(z.string()).optional(),
        target: z.enum(["ALL", "ACTIVE_LISTENERS", "INACTIVE_7D", "TODAY_REGISTERED", "SPECIFIC"]).default("ALL"),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(1000),
        link: z.string().optional(),
        type: z.string().default("CAMPAIGN"),
        sendEmail: z.boolean().default(false),
        sendPush: z.boolean().default(true),
      });

      const data = schema.parse(req.body);
      let targetUserIds: string[] = [];

      if (data.target === "SPECIFIC" && data.userIds && data.userIds.length > 0) {
        targetUserIds = data.userIds;
      } else if (data.target === "ALL") {
        const users = await prisma.user.findMany({ select: { id: true }, take: 5000 });
        targetUserIds = users.map((u) => u.id);
      } else if (data.target === "TODAY_REGISTERED") {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const users = await prisma.user.findMany({
          where: {
            createdAt: { gte: startOfDay },
          },
          select: { id: true },
          take: 5000,
        });
        targetUserIds = users.map((u) => u.id);
      } else if (data.target === "INACTIVE_7D") {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const users = await prisma.user.findMany({
          where: {
            updatedAt: { lt: sevenDaysAgo },
          },
          select: { id: true },
          take: 1000,
        });
        targetUserIds = users.map((u) => u.id);
      } else if (data.target === "ACTIVE_LISTENERS") {
        const users = await prisma.user.findMany({
          where: {
            playbackHistories: { some: {} },
          },
          select: { id: true },
          take: 1000,
        });
        targetUserIds = users.map((u) => u.id);
      }

      if (targetUserIds.length > 0) {
        await NotificationService.notify(
          targetUserIds,
          {
            type: data.type,
            title: data.title,
            body: data.body,
            link: data.link,
          },
          {
            email: data.sendEmail,
          }
        );
      }

      return sendSuccess(res, {
        sentCount: targetUserIds.length,
        title: data.title,
        sendPush: data.sendPush,
        sendEmail: data.sendEmail,
      });
    } catch (e) {
      return fail(res, e);
    }
  }

  /**
   * Endpoint de synchronisation de la curation éditoriale (utilisable par n8n)
   * Authentification : Soit header 'x-automation-secret', soit JWT d'un administrateur.
   */
  static async syncEditorialCuration(req: any, res: Response) {
    try {
      const secret = process.env.AUTOMATION_SECRET || process.env.JWT_SECRET;
      const providedSecret = req.headers["x-automation-secret"];
      const user = req.user;
      const isAuthorized =
        (secret && providedSecret === secret) ||
        (user && (user.role === "ADMIN" || user.role === "SUPER_ADMIN"));

      if (!isAuthorized) {
        return sendError(res, "Accès réservé au système d'automatisation ou aux administrateurs.", "UNAUTHORIZED", 403);
      }

      const schema = z.object({
        title: z.string().min(1).max(200),
        subtitle: z.string().optional().nullable(),
        episodeIds: z.array(z.string()).min(1),
        slug: z.string().default("selection-ia"),
      });

      const data = schema.parse(req.body);

      // Upsert de la section éditoriale
      const section = await prisma.editorialSection.upsert({
        where: { slug: data.slug },
        update: {
          title: data.title,
          subtitle: data.subtitle || null,
          isActive: true,
          updatedAt: new Date(),
        },
        create: {
          id: "cm_sec_selection_ia",
          title: data.title,
          subtitle: data.subtitle || null,
          slug: data.slug,
          type: "EPISODE_ROW",
          sourceMode: "AUTOMATIC",
          position: 1,
          isActive: true,
          maxItems: 10,
          isFixedPlacement: true,
          priority: 100,
          selectionStrategy: "CURATION_IA",
        },
      });

      // Supprimer les anciens items de cette section
      await prisma.editorialSectionItem.deleteMany({
        where: { sectionId: section.id },
      });

      // Filtrer les épisodes existants en base pour garantir l'intégrité référentielle
      const existingEpisodes = await prisma.episode.findMany({
        where: { id: { in: data.episodeIds } },
        select: { id: true },
      });
      const validIdSet = new Set(existingEpisodes.map((e) => e.id));
      const validOrderedIds = data.episodeIds.filter((id) => validIdSet.has(id));

      if (validOrderedIds.length > 0) {
        await prisma.editorialSectionItem.createMany({
          data: validOrderedIds.map((episodeId, index) => ({
            sectionId: section.id,
            episodeId,
            position: index,
          })),
        });
      }

      return sendSuccess(res, {
        sectionId: section.id,
        slug: section.slug,
        title: section.title,
        subtitle: section.subtitle,
        itemsCount: validOrderedIds.length,
      }, "Section éditoriale synchronisée avec succès");
    } catch (e) {
      return fail(res, e);
    }
  }
}

