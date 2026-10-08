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
  }) {
    const { countryId, languageCode, categorySlug, topicSlug, search, limit = 20, cursor } = params;

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

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { alternateTitles: { some: { title: { contains: search, mode: "insensitive" } } } },
      ];
    }

    // Cursor Pagination
    const podcasts = await prisma.podcast.findMany({
      where,
      take: limit + 1, // Prendre +1 pour savoir s'il reste d'autres éléments (hasMore)
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
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
    });

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
        nextCursor,
        hasMore,
        limit,
      },
    };
  }

  static async getPodcastBySlug(slug: string) {
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
          where: { status: "PUBLISHED" },
          orderBy: { publishedAt: "desc" },
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
          select: { episodes: true, followers: true },
        },
      },
    });

    // Visible publiquement seulement s'il est publié ou non répertorié (accessible par son lien).
    if (!podcast || (podcast.status !== "PUBLISHED" && podcast.status !== "UNLISTED")) return null;

    return {
      ...podcast,
      episodes: podcast.episodes.map(formatEpisodeWithMediaFlags),
    };
  }
}
