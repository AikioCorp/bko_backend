import { prisma } from "../../config/prisma.js";

export class EpisodeService {
  static async getEpisodeBySlug(podcastSlug: string, episodeSlug: string) {
    const episode = await prisma.episode.findFirst({
      where: {
        slug: episodeSlug,
        podcast: {
          slug: podcastSlug,
          status: { in: ["PUBLISHED", "UNLISTED"] },
        },
        status: "PUBLISHED",
      },
      include: {
        podcast: {
          include: {
            country: true,
            primaryLanguage: true,
            organization: true,
          },
        },
        season: true,
        mediaSources: {
          // Seule l'info utile au lecteur : jamais le bucket ni la clé de stockage.
          include: { mediaAsset: { select: { status: true, durationSeconds: true, mimeType: true } } },
        },
        people: {
          include: {
            person: true,
          },
        },
        topics: {
          include: {
            topic: true,
          },
        },
        _count: {
          select: { EpisodeLike: true, Comment: { where: { isVisible: true } } }
        },
        transcripts: {
          where: { type: "ORIGINAL" },
          include: {
            segments: {
              orderBy: { startTimeMs: "asc" },
            },
          },
        },
      },
    });

    return episode;
  }

  static async getRecentEpisodes(limit = 20, offset = 0) {
    const [total, episodes] = await Promise.all([
      prisma.episode.count({ where: { status: "PUBLISHED", podcast: { status: "PUBLISHED" } } }),
      prisma.episode.findMany({
        where: { status: "PUBLISHED", podcast: { status: "PUBLISHED" } },
        take: limit,
        skip: offset,
        orderBy: { publishedAt: "desc" },
        include: {
          podcast: {
            include: {
              country: true,
            },
          },
          season: true,
          mediaSources: true,
          people: {
            include: {
              person: true,
            },
          },
        },
      }),
    ]);

    return { episodes, total, limit, offset };
  }
}
