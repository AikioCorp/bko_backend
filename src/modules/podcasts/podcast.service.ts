import { prisma } from "../../config/prisma.js";

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
        _count: {
          select: { episodes: true, followers: true },
        },
      },
    });

    let hasMore = false;
    let nextCursor: string | null = null;

    if (podcasts.length > limit) {
      hasMore = true;
      const nextItem = podcasts.pop();
      nextCursor = nextItem?.id || null;
    }

    return {
      data: podcasts,
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

    return podcast;
  }
}
