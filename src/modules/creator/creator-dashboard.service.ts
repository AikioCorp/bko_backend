import { prisma } from "../../config/prisma.js";

export class CreatorDashboardService {
  static async getDashboardMetrics(userId: string) {
    const memberships = await prisma.podcastMember.findMany({
      where: { userId },
      select: { podcastId: true },
    });

    const podcastIds = memberships.map((m) => m.podcastId);

    const [podcastsCount, episodesCount, totalFollowers, draftEpisodes, scheduledEpisodes, recentEpisodes, pendingReview, rejected, failedMedia, plays30d] =
      await Promise.all([
        prisma.podcast.count({ where: { id: { in: podcastIds } } }),
        prisma.episode.count({ where: { podcastId: { in: podcastIds }, status: "PUBLISHED" } }),
        prisma.podcastFollow.count({ where: { podcastId: { in: podcastIds } } }),
        prisma.episode.count({ where: { podcastId: { in: podcastIds }, status: "DRAFT" } }),
        prisma.episode.count({ where: { podcastId: { in: podcastIds }, status: "SCHEDULED" } }),
        prisma.episode.findMany({
          where: { podcastId: { in: podcastIds } },
          orderBy: { updatedAt: "desc" },
          take: 5,
          include: {
            podcast: { select: { id: true, name: true, cover: true } },
            mediaSources: true,
          },
        }),
        prisma.episode.count({ where: { podcastId: { in: podcastIds }, status: "PENDING_REVIEW" } }),
        // Contenus renvoyés par la modération avec un motif : à corriger puis re-soumettre.
        prisma.episode.findMany({
          where: { podcastId: { in: podcastIds }, status: "DRAFT", reviewNote: { not: null } },
          orderBy: { reviewedAt: "desc" },
          take: 10,
          select: { id: true, title: true, reviewNote: true, reviewedAt: true, podcast: { select: { id: true, name: true } } },
        }),
        prisma.mediaAsset.count({ where: { ownerId: userId, status: "FAILED" } }),
        prisma.episodeDailyStats.aggregate({
          where: { date: { gte: new Date(Date.now() - 30 * 86400000) }, episode: { podcastId: { in: podcastIds } } },
          _sum: { plays: true },
        }),
      ]);

    return {
      podcastsCount,
      episodesCount,
      totalFollowers,
      draftEpisodes,
      scheduledEpisodes,
      recentEpisodes,
      pendingReview,
      rejected,
      failedMedia,
      plays30d: plays30d._sum.plays ?? 0,
    };
  }
}
