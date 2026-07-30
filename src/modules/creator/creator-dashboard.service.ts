import { prisma } from "../../config/prisma.js";

export class CreatorDashboardService {
  static async getDashboardMetrics(userId: string) {
    const memberships = await prisma.podcastMember.findMany({
      where: { userId },
      select: { podcastId: true },
    });

    const podcastIds = memberships.map((m) => m.podcastId);

    const [podcastsCount, episodesCount, totalFollowers, draftEpisodes, scheduledEpisodes, recentEpisodes] =
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
      ]);

    return {
      podcastsCount,
      episodesCount,
      totalFollowers,
      draftEpisodes,
      scheduledEpisodes,
      recentEpisodes,
    };
  }
}
