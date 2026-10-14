import { PodcastMemberRole } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { MailService } from "./mail/mail.service.js";
import { Emails } from "./mail/email-templates.js";
import { PushNotificationService } from "./push-notification.service.js";

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  /** Chemin interne du site (commence par "/"). Jamais de secret ni de jeton dans un lien. */
  link?: string;
}

const safeLink = (l?: string) => (l && l.startsWith("/") && !l.startsWith("//") ? l : undefined);

/**
 * Notifications dans l'application, avec email optionnel (file avec nouvelles tentatives).
 * Les notifications ne doivent JAMAIS faire échouer l'action métier qui les déclenche :
 * toute erreur est journalisée puis avalée.
 */
export class NotificationService {
  static async notify(userIds: string[], n: NotificationInput, opts: { email?: boolean } = {}) {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (ids.length === 0) return;
    try {
      const link = safeLink(n.link);
      await prisma.notification.createMany({
        data: ids.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body, link })),
      });

      // Envoi Push Notification (FCM / APNs)
      void PushNotificationService.sendToUsers(ids, {
        title: n.title,
        body: n.body || "",
        route: link,
      });

      if (opts.email) {
        const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { email: true } });
        await Promise.all(users.map((u) => MailService.enqueue(Emails.notification(u.email, { title: n.title, body: n.body, link }))));
      }
    } catch (e: any) {
      console.error("[notification] échec :", e.message);
    }
  }

  /** Membres d'un podcast (par défaut ceux qui gèrent le contenu). */
  static async teamOf(podcastId: string, roles: PodcastMemberRole[] = ["OWNER", "ADMIN", "EDITOR"]) {
    const members = await prisma.podcastMember.findMany({ where: { podcastId, role: { in: roles } }, select: { userId: true } });
    return members.map((m) => m.userId);
  }

  static async notifyTeam(podcastId: string, n: NotificationInput, opts: { email?: boolean; exclude?: string } = {}) {
    const ids = (await this.teamOf(podcastId)).filter((id) => id !== opts.exclude);
    await this.notify(ids, n, { email: opts.email });
  }

  /** Prévient les abonnés (préférences in-app, push et email respectées, activées par défaut). */
  static async notifyFollowersOfEpisode(episodeId: string) {
    try {
      const episode = await prisma.episode.findUnique({
        where: { id: episodeId },
        select: { title: true, slug: true, podcastId: true, status: true, podcast: { select: { name: true, slug: true } } },
      });
      if (!episode || episode.status !== "PUBLISHED") return;

      const link = `/podcasts/${episode.podcast.slug}/episodes/${episode.slug}`;

      // Éviter les notifications répétées lorsqu'un épisode est republié ou qu'un traitement est relancé
      const alreadyNotified = await prisma.notification.findFirst({
        where: { link, type: "NEW_EPISODE" },
        select: { id: true },
      });
      if (alreadyNotified) {
        console.log(`[notification] Épisode déjà notifié aux abonnés : ${episodeId}`);
        return;
      }

      const where = {
        podcastId: episode.podcastId,
        user: { isSuspended: false },
      };

      // Par lots, pour ne jamais charger tous les abonnés d'un gros podcast en mémoire.
      let cursor: { userId_podcastId: { userId: string; podcastId: string } } | undefined;
      for (;;) {
        const batch = await prisma.podcastFollow.findMany({
          where,
          take: 1000,
          orderBy: { userId: "asc" },
          select: {
            userId: true,
            user: {
              select: {
                id: true,
                email: true,
                isSuspended: true,
                notificationPreference: {
                  select: {
                    pushNewEpisodes: true,
                    emailNewEpisodes: true,
                  },
                },
              },
            },
          },
          ...(cursor ? { cursor, skip: 1 } : {}),
        });
        if (batch.length === 0) break;

        const activeUsers = batch.map((f) => f.user).filter((u) => u && !u.isSuspended);
        if (activeUsers.length === 0) {
          if (batch.length < 1000) break;
          cursor = { userId_podcastId: { userId: batch[batch.length - 1].userId, podcastId: episode.podcastId } };
          continue;
        }

        // 1. Notification interne (toujours créée pour les abonnés non suspendus)
        await prisma.notification.createMany({
          data: activeUsers.map((u) => ({
            userId: u.id,
            type: "NEW_EPISODE",
            title: `Nouvel épisode : ${episode.podcast.name}`,
            body: episode.title,
            link,
          })),
        });

        // 2. Notification Push (si activée ou non explicitement désactivée)
        const pushUserIds = activeUsers
          .filter((u) => u.notificationPreference?.pushNewEpisodes !== false)
          .map((u) => u.id);

        if (pushUserIds.length > 0) {
          void PushNotificationService.sendToUsers(pushUserIds, {
            title: `Nouvel épisode : ${episode.podcast.name}`,
            body: episode.title,
            route: link,
          });
        }

        // 3. Email (uniquement si explicitement activé ou par défaut activé)
        const emailUsers = activeUsers.filter((u) => u.notificationPreference?.emailNewEpisodes === true);
        if (emailUsers.length > 0) {
          await Promise.all(
            emailUsers.map((u) =>
              MailService.enqueue(
                Emails.notification(u.email, {
                  title: `Nouvel épisode : ${episode.podcast.name}`,
                  body: episode.title,
                  link,
                })
              )
            )
          ).catch((err: any) => console.error("[notification] échec envoi email abonnés :", err.message));
        }

        if (batch.length < 1000) break;
        cursor = { userId_podcastId: { userId: batch[batch.length - 1].userId, podcastId: episode.podcastId } };
      }
    } catch (e: any) {
      console.error("[notification] abonnés :", e.message);
    }
  }

  // ───────────── Lecture par l'utilisateur ─────────────

  static async list(userId: string, limit: number, before?: string) {
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true },
      }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unread };
  }

  static async unreadCount(userId: string) {
    return prisma.notification.count({ where: { userId, readAt: null } });
  }

  /** Marque comme lues les notifications données (ou toutes). Filtrée par userId : pas d'accès aux notifications d'autrui. */
  static async markRead(userId: string, ids?: string[]) {
    const r = await prisma.notification.updateMany({
      where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { updated: r.count };
  }

  /** Purge des notifications lues de plus de 90 jours (appelée périodiquement par le worker). */
  static async purgeOld() {
    const limit = new Date(Date.now() - 90 * 86400000);
    return prisma.notification.deleteMany({ where: { readAt: { not: null, lt: limit } } });
  }
}
