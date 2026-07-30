import { prisma } from "../../config/prisma.js";

export class EpisodeService {
  static async getEpisodeBySlug(podcastSlug: string, episodeSlug: string) {
    const episode = await prisma.episode.findFirst({
      where: {
        slug: episodeSlug,
        podcast: {
          slug: podcastSlug,
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
          include: {
            mediaAsset: true,
          },
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
      prisma.episode.count({ where: { status: "PUBLISHED" } }),
      prisma.episode.findMany({
        where: { status: "PUBLISHED" },
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
