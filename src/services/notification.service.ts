import { PodcastMemberRole } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { MailService } from "./mail/mail.service.js";
import { Emails } from "./mail/email-templates.js";

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

  /** Prévient les abonnés (préférence "nouveaux épisodes" respectée, activée par défaut). */
  static async notifyFollowersOfEpisode(episodeId: string) {
    try {
      const episode = await prisma.episode.findUnique({
        where: { id: episodeId },
        select: { title: true, slug: true, podcastId: true, status: true, podcast: { select: { name: true, slug: true } } },
      });
      if (!episode || episode.status !== "PUBLISHED") return;

      const link = `/podcasts/${episode.podcast.slug}/episodes/${episode.slug}`;
      const where = {
        podcastId: episode.podcastId,
        user: { OR: [{ notificationPreference: { is: null } }, { notificationPreference: { pushNewEpisodes: true } }] },
      };
      // Par lots, pour ne jamais charger tous les abonnés d'un gros podcast en mémoire.
      let cursor: { userId_podcastId: { userId: string; podcastId: string } } | undefined;
      for (;;) {
        const batch = await prisma.podcastFollow.findMany({
          where,
          take: 1000,
          orderBy: { userId: "asc" },
          select: { userId: true },
          ...(cursor ? { cursor, skip: 1 } : {}),
        });
        if (batch.length === 0) break;
        await prisma.notification.createMany({
          data: batch.map((f) => ({
            userId: f.userId,
            type: "NEW_EPISODE",
            title: `Nouvel épisode : ${episode.podcast.name}`,
            body: episode.title,
            link,
          })),
        });
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
