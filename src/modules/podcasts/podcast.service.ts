import { prisma } from "../../config/prisma.js";
import { formatEpisodeWithMediaFlags } from "../../utils/episode.js";

export class PodcastService {
  static async getPodcasts(params: {
    countryId?: string;
    languageCode?: string;
    categorySlug?: string;
    topicSlug?: string;
    search?: string;
    limit?: number;
    cursor?: string;
    offset?: number;
    sort?: "recent" | "oldest" | "popular";
  }) {
    const { countryId, languageCode, categorySlug, topicSlug, search, limit = 20, cursor, offset, sort = "recent" } = params;

    // Filtre strict : Uniquement podcasts PUBLIÉS pour la vue publique
    const where: any = {
      status: "PUBLISHED",
    };

    if (countryId) {
      where.countryId = countryId;
    }

    if (languageCode) {
      where.OR = [
        { primaryLanguageCode: languageCode },
        { secondaryLanguages: { some: { languageCode } } },
      ];
    }

    if (categorySlug) {
      where.categories = {
        some: {
          category: {
            slug: categorySlug,
          },
        },
      };
    }

    if (topicSlug) {
      where.topics = {
        some: {
          topic: {
            slug: topicSlug,
          },
        },
      };
    }

    if (search && search.trim()) {
      const q = search.trim();
      const searchConditions = [
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { alternateTitles: { some: { title: { contains: q, mode: "insensitive" } } } },
      ];
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: searchConditions }];
        delete where.OR;
      } else {
        where.OR = searchConditions;
      }
    }

    let orderBy: any = { createdAt: "desc" };
    if (sort === "oldest") {
      orderBy = { createdAt: "asc" };
    } else if (sort === "popular") {
      orderBy = { followers: { _count: "desc" } };
    }

    const [total, podcasts] = await Promise.all([
      prisma.podcast.count({ where }),
      prisma.podcast.findMany({
        where,
        take: limit + 1, // Prendre +1 pour savoir s'il reste d'autres éléments (hasMore)
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : offset ? { skip: offset } : {}),
        orderBy,
        include: {
          country: true,
          primaryLanguage: true,
          categories: {
            include: {
              category: true,
            },
          },
          topics: {
            include: {
              topic: true,
            },
          },
          permanentPersons: {
            include: {
              person: true,
            },
          },
          episodes: {
            where: { status: "PUBLISHED" },
            orderBy: { publishedAt: "desc" },
            take: 1,
            include: {
              mediaSources: true,
            },
          },
          _count: {
            select: { episodes: true, followers: true },
          },
        },
      }),
    ]);

    let hasMore = false;
    let nextCursor: string | null = null;

    if (podcasts.length > limit) {
      hasMore = true;
      podcasts.pop();
      nextCursor = podcasts[podcasts.length - 1]?.id || null;
    }

    const formattedPodcasts = podcasts.map((p) => ({
      ...p,
      episodes: (p.episodes || []).map(formatEpisodeWithMediaFlags),
    }));

    return {
      data: formattedPodcasts,
      pagination: {
        total,
        nextCursor,
        hasMore,
        limit,
        offset: offset || 0,
      },
    };
  }

  static async getPodcastBySlug(slug: string, episodeLimit?: number, episodeOffset = 0,
    episodeSort: "recent" | "oldest" = "recent", episodeType?: "AUDIO" | "VIDEO") {
    const episodeWhere = {
      status: "PUBLISHED" as const,
      ...(episodeType ? { mediaSources: { some: { type: episodeType } } } : {}),
    };
    const direction = episodeSort === "oldest" ? "asc" as const : "desc" as const;
    const podcast = await prisma.podcast.findUnique({
      where: { slug },
      include: {
        country: true,
        primaryLanguage: true,
        secondaryLanguages: {
          include: {
            language: true,
          },
        },
        alternateTitles: true,
        organization: true,
        categories: {
          include: {
            category: true,
          },
        },
        topics: {
          include: {
            topic: true,
          },
        },
        seasons: {
          orderBy: { number: "asc" },
        },
        externalSources: true,
        permanentPersons: {
          include: {
            person: true,
          },
        },
        episodes: {
          where: episodeWhere,
          orderBy: [{ publishedAt: direction }, { id: direction }],
          ...(episodeLimit ? { take: episodeLimit + 1, skip: episodeOffset } : {}),
          include: {
            mediaSources: true,
            people: {
              include: {
                person: true,
              },
            },
          },
        },
        _count: {
          select: { episodes: { where: episodeWhere }, followers: true },
        },
      },
    });

    // Visible publiquement seulement s'il est publié ou non répertorié (accessible par son lien).
    if (!podcast || (podcast.status !== "PUBLISHED" && podcast.status !== "UNLISTED")) return null;

    return {
      ...podcast,
      episodes: (episodeLimit ? podcast.episodes.slice(0, episodeLimit) : podcast.episodes).map(formatEpisodeWithMediaFlags),
      ...(episodeLimit ? { episodesPage: { hasMore: podcast.episodes.length > episodeLimit, nextOffset: episodeOffset + Math.min(episodeLimit, podcast.episodes.length) } } : {}),
    };
  }
}
