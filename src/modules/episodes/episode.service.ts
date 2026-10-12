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

  static async getCatalogEpisodes(params: {
    search?: string;
    categorySlug?: string;
    languageCode?: string;
    countryId?: string;
    mediaType?: "ALL" | "AUDIO" | "VIDEO";
    duration?: "ALL" | "SHORT" | "MEDIUM" | "LONG";
    sort?: "recent" | "oldest" | "popular";
    limit?: number;
    offset?: number;
  }) {
    const {
      search,
      categorySlug,
      languageCode,
      countryId,
      mediaType,
      duration,
      sort = "recent",
      limit = 24,
      offset = 0,
    } = params;

    const where: any = {
      status: "PUBLISHED",
      podcast: {
        status: "PUBLISHED",
      },
    };

    if (countryId) {
      where.podcast.countryId = countryId;
    }

    if (categorySlug) {
      where.podcast.categories = {
        some: {
          category: {
            slug: categorySlug,
          },
        },
      };
    }

    if (languageCode) {
      where.OR = [
        { languageCode },
        { podcast: { primaryLanguageCode: languageCode } },
      ];
    }

    if (mediaType && mediaType !== "ALL") {
      where.mediaSources = {
        some: {
          type: mediaType,
        },
      };
    }

    if (duration && duration !== "ALL") {
      if (duration === "SHORT") {
        where.durationSeconds = { lte: 900 }; // <= 15 min
      } else if (duration === "MEDIUM") {
        where.durationSeconds = { gt: 900, lte: 2700 }; // 15 - 45 min
      } else if (duration === "LONG") {
        where.durationSeconds = { gt: 2700 }; // > 45 min
      }
    }

    if (search && search.trim()) {
      const q = search.trim();
      const searchConditions = [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { podcast: { name: { contains: q, mode: "insensitive" } } },
      ];
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: searchConditions }];
        delete where.OR;
      } else {
        where.OR = searchConditions;
      }
    }

    let orderBy: any = { publishedAt: "desc" };
    if (sort === "oldest") {
      orderBy = { publishedAt: "asc" };
    } else if (sort === "popular") {
      orderBy = { publishedAt: "desc" }; // Base ordering; can combine with plays
    }

    const [total, rawEpisodes] = await Promise.all([
      prisma.episode.count({ where }),
      prisma.episode.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy,
        include: {
          podcast: {
            include: {
              country: true,
              primaryLanguage: true,
              categories: {
                include: {
                  category: true,
                },
              },
            },
          },
          season: true,
          mediaSources: true,
          people: {
            include: {
              person: true,
            },
          },
          _count: {
            select: { EpisodeLike: true, Comment: { where: { isVisible: true } } },
          },
        },
      }),
    ]);

    const episodes = rawEpisodes.map((ep) => {
      const mediaSources = ep.mediaSources || [];
      const audioAvailable = mediaSources.some((s) => s.type === "AUDIO");
      const videoAvailable = mediaSources.some((s) => s.type === "VIDEO");
      const primaryAudioSource =
        mediaSources.find((s) => s.isPrimaryAudio) ||
        mediaSources.find((s) => s.type === "AUDIO") ||
        null;
      const primaryVideoSource =
        mediaSources.find((s) => s.isPrimaryVideo) ||
        mediaSources.find((s) => s.type === "VIDEO") ||
        null;

      return {
        ...ep,
        audioAvailable,
        videoAvailable,
        defaultMode: audioAvailable ? "AUDIO" : "VIDEO",
        primaryAudioSource,
        primaryVideoSource,
      };
    });

    // Diversification éditoriale / anti-clustering : évite d'afficher consécutivement
    // plusieurs épisodes de la même émission pour offrir un catalogue vivant et varié.
    const diversifiedEpisodes = this.interleaveEpisodesByPodcast(episodes);

    return {
      episodes: diversifiedEpisodes,
      total,
      limit,
      offset,
      hasMore: offset + episodes.length < total,
    };
  }

  private static interleaveEpisodesByPodcast<T extends { podcastId: string }>(items: T[]): T[] {
    if (items.length <= 2) return items;
    const result: T[] = [];
    const pool = [...items];

    while (pool.length > 0) {
      const lastPodcastId = result.length > 0 ? result[result.length - 1].podcastId : null;
      const nextIdx = pool.findIndex((ep) => ep.podcastId !== lastPodcastId);
      if (nextIdx !== -1) {
        result.push(pool.splice(nextIdx, 1)[0]);
      } else {
        result.push(...pool.splice(0));
      }
    }
    return result;
  }
}

