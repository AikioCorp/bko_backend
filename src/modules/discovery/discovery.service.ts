import { prisma } from "../../config/prisma.js";
import { formatEpisodeWithMediaFlags } from "../../utils/episode.js";

export class DiscoveryService {
  static async getCategoryShelves(countryId = "all") {
    const published = { status: "PUBLISHED" as const, ...(countryId !== "all" ? {countryId} : {}), episodes: {some: {status: "PUBLISHED" as const}} };
    const categories = await prisma.category.findMany({
      where: {podcasts: {some: {podcast: published}}},
      orderBy: {name: "asc"},
      take: 12,
      include: {
        _count: {select: {podcasts: {where: {podcast: published}}}},
        podcasts: {where: {podcast: published},take: 8,orderBy: {podcast: {updatedAt: "desc"}},include: {podcast: {
          include: {primaryLanguage: true, country: true, categories: {include: {category: true}},
            _count: {select: {episodes: {where: {status: "PUBLISHED"}},followers: true}}}
        }}}
      }
    });
    return categories.map(category => ({id:category.id,slug:category.slug,name:category.name,count:category._count.podcasts,podcasts:category.podcasts.map(item=>item.podcast)}));
  }

  static async getExploreData() {
    const [countries, languages, categories, topics] = await Promise.all([
      prisma.country.findMany({
        orderBy: { id: "asc" },
        include: { _count: { select: { podcasts: true } } },
      }),
      prisma.language.findMany({
        include: { _count: { select: { primaryPodcasts: true } } },
      }),
      prisma.category.findMany({
        include: { _count: { select: { podcasts: true } } },
      }),
      prisma.topic.findMany({
        include: {
          aliases: true,
          _count: { select: { podcasts: true, episodes: true } },
        },
      }),
    ]);

    return {
      countries,
      languages,
      categories,
      topics,
      defaultCountry: "ML", // Mali First
    };
  }

  
  private static trendingCache: { data: any, timestamp: number, country: string } | null = null;
  private static readonly CACHE_TTL = 15 * 60 * 1000; // 15 minutes

  /**
   * Calcul DǸterministe des Tendances (Trending Algorithm)
   */
  static async getTrendingPodcasts(limit = 50, countryId?: string) {
    const cacheKey = countryId || "all";
    if (this.trendingCache && this.trendingCache.country === cacheKey && (Date.now() - this.trendingCache.timestamp) < this.CACHE_TTL) {
      return this.trendingCache.data.slice(0, limit);
    }

    // Agrégation optimisée en base pour les statistiques (Évite le crash mémoire)
    const episodeStats = await prisma.$queryRaw`SELECT stats."episodeId", SUM(stats."plays") as plays, SUM(stats."qualifiedPlays") as "qualifiedPlays" FROM "EpisodeDailyStats" stats JOIN "Episode" ep ON ep.id = stats."episodeId" JOIN "Podcast" podcast ON podcast.id = ep."podcastId" WHERE stats.date >= CURRENT_DATE - INTERVAL '30 days' AND ep.status = 'PUBLISHED' AND podcast.status = 'PUBLISHED' GROUP BY stats."episodeId"` as any[];
    
    const statsMap = new Map(episodeStats.map(s => [s.episodeId, { plays: Number(s.plays) || 0, qualified: Number(s.qualifiedplays || s.qualifiedPlays) || 0 }]));

    const podcasts = await prisma.podcast.findMany({
      where: {
        status: "PUBLISHED",
        episodes: {some: {status: "PUBLISHED"}},
        ...(countryId && countryId !== "all" ? { countryId } : {}),
      },
      include: {
        country: true,
        primaryLanguage: true,
        categories: { include: { category: true } },
        episodes: {
          where: { status: "PUBLISHED" },
          orderBy: { publishedAt: "desc" },
          take: 5,
          select: { id: true }
        },
        _count: { select: { episodes: {where: {status: "PUBLISHED"}}, followers: true } },
      },
    });

    // Calcul du score dǸterministe pour chaque podcast
    const scoredPodcasts = podcasts.map((p) => {
      let totalPlays = 0;
      let totalQualified = 0;

      p.episodes.forEach((ep) => {
        const stat = statsMap.get(ep.id);
        if (stat) {
          totalPlays += stat.plays;
          totalQualified += stat.qualified;
        }
      });

      const followersScore = p._count.followers * 5;
      const playsScore = totalPlays * 2;
      const qualifiedScore = totalQualified * 3;

      // Bonus de rǸcence (si crǸǸ dans les 30 derniers jours)
      const ageDays = (Date.now() - new Date(p.createdAt).getTime()) / (1000 * 3600 * 24);
      const recencyBonus = ageDays < 30 ? Math.max(0, 500 - ageDays * 15) : 0;

      const trendingScore = playsScore + qualifiedScore + followersScore + recencyBonus;

      return {
        podcast: p,
        trendingScore,
      };
    });

        // Tri par score dǸcroissant
    scoredPodcasts.sort((a, b) => b.trendingScore - a.trendingScore);
    const sortedPodcasts = scoredPodcasts.map((sp) => sp.podcast);

    this.trendingCache = {
      data: sortedPodcasts,
      timestamp: Date.now(),
      country: cacheKey
    };

    return sortedPodcasts.slice(0, limit);
  }

  /**
   * Sections dynamiques de l'Accueil (Ne retourne jamais de section vide)
   */
  static async getHomeSections() {
    const now = new Date();
    const sections = await prisma.editorialSection.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { position: "asc" },
      include: {
        items: {
          orderBy: { position: "asc" },
          include: {
            podcast: {
              include: {
                country: true,
                primaryLanguage: true,
                categories: { include: { category: true } },
                _count: { select: { episodes: {where: {status: "PUBLISHED"}}, followers: true } },
              },
            },
            episode: {
              include: {
                podcast: { include: { country: true, primaryLanguage: true } },
                mediaSources: true,
              },
            },
            person: true,
            collection: true,
            topic: true,
          },
        },
      },
    });

    // Masquer automatiquement les sections vides et formater les Ǹpisodes
    const activeSections = sections
      .filter((s) => s.items && s.items.length > 0)
      .map((s) => ({
        ...s,
        items: s.items
          .map((item) => ({
            ...item,
            episode: item.episode ? formatEpisodeWithMediaFlags(item.episode) : null,
          }))
          // Un ǸlǸment Ǹditorial dont le podcast/Ǹpisode n'est plus publiǸ disparaǩt de l'accueil.
          .filter((item) => {
            if (item.podcast && item.podcast.status !== "PUBLISHED") return false;
            if (item.episode && (item.episode.status !== "PUBLISHED" || item.episode.podcast.status !== "PUBLISHED")) return false;
            return !!(item.podcast || item.episode || item.person || item.collection || item.topic);
          }),
      }))
      .filter((s) => s.items.length > 0);

    return activeSections;
  }
}
