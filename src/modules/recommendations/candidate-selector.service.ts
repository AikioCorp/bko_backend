import { prisma } from "../../config/prisma.js";
import {
  RecommendationCandidateEpisode,
  RecommendationCandidatePodcast,
  UserInterestProfile,
} from "./recommendation.types.js";
import { EmbeddingService } from "./embedding.service.js";

export class CandidateSelectorService {
  /**
   * Sélectionne des épisodes candidats à partir de sources diversifiées :
   * - Nouveautés des émissions suivies
   * - Thèmes et catégories affinitaires
   * - Proximité sémantique avec écoutes marquantes
   * - Nouveautés de découverte
   * - Tendances récentes
   */
  static async selectEpisodeCandidates(
    profile: UserInterestProfile | null,
    countryId = "all",
    limit = 60
  ): Promise<RecommendationCandidateEpisode[]> {
    const publishedFilter = {
      status: "PUBLISHED" as const,
      podcast: {
        status: "PUBLISHED" as const,
        ...(countryId !== "all" ? { countryId } : {}),
      },
    };

    // Récupérer les exclusions utilisateur (pas intéressé, podcast masqué)
    const excludedEpisodeIds = new Set<string>();
    const excludedPodcastIds = new Set<string>();

    if (profile?.userId) {
      const feedback = await prisma.userContentFeedback.findMany({
        where: { userId: profile.userId },
      });
      for (const fb of feedback) {
        if (fb.action === "NOT_INTERESTED" || fb.action === "EXCLUDE_FROM_PROFILE") {
          if (fb.episodeId) excludedEpisodeIds.add(fb.episodeId);
        }
        if (fb.action === "HIDE_PODCAST" && fb.podcastId) {
          excludedPodcastIds.add(fb.podcastId);
        }
      }
    }

    const candidateMap = new Map<string, RecommendationCandidateEpisode>();

    // 1. Source: Nouveaux épisodes des émissions suivies (si utilisateur connecté)
    if (profile?.userId) {
      const follows = await prisma.podcastFollow.findMany({
        where: { userId: profile.userId },
        select: { podcastId: true },
      });
      const followedIds = follows
        .map((f) => f.podcastId)
        .filter((id) => !excludedPodcastIds.has(id));

      if (followedIds.length > 0) {
        const followedEpisodes = await prisma.episode.findMany({
          where: {
            ...publishedFilter,
            podcastId: { in: followedIds },
            id: { notIn: Array.from(excludedEpisodeIds) },
          },
          orderBy: { publishedAt: "desc" },
          take: 20,
          include: {
            podcast: {
              include: { categories: { include: { category: true } } },
            },
            mediaSources: true,
            language: true,
          },
        });

        for (const ep of followedEpisodes) {
          candidateMap.set(ep.id, {
            ...ep,
            candidateSource: "followed_podcasts",
            matchReason: `Nouvel épisode de ${ep.podcast.name}`,
          });
        }
      }
    }

    // 2. Source: Thèmes et catégories affinitaires
    const topCategories = profile?.categoryScores
      ? Object.entries(profile.categoryScores)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([c]) => c)
      : [];

    if (topCategories.length > 0) {
      const affinityEpisodes = await prisma.episode.findMany({
        where: {
          ...publishedFilter,
          podcast: {
            ...publishedFilter.podcast,
            categories: { some: { categoryId: { in: topCategories } } },
          },
          id: { notIn: Array.from(excludedEpisodeIds) },
        },
        orderBy: { publishedAt: "desc" },
        take: 30,
        include: {
          podcast: {
            include: { categories: { include: { category: true } } },
          },
          mediaSources: true,
          language: true,
        },
      });

      for (const ep of affinityEpisodes) {
        if (!candidateMap.has(ep.id) && !excludedPodcastIds.has(ep.podcastId)) {
          candidateMap.set(ep.id, {
            ...ep,
            candidateSource: "category_affinity",
            matchReason: "Selon vos thèmes favoris",
          });
        }
      }
    }

    // 3. Source: Similarité sémantique (si écoute marquante récente)
    const recentPodcastId = profile?.recentSignals?.lastInteractedPodcast;
    if (recentPodcastId && !excludedPodcastIds.has(recentPodcastId)) {
      try {
        const similarPodcasts = await EmbeddingService.findSimilarPodcasts(recentPodcastId, 4);
        const similarIds = similarPodcasts.map((s) => s.podcastId).filter((id) => !excludedPodcastIds.has(id));

        if (similarIds.length > 0) {
          const semanticEpisodes = await prisma.episode.findMany({
            where: {
              ...publishedFilter,
              podcastId: { in: similarIds },
              id: { notIn: Array.from(excludedEpisodeIds) },
            },
            orderBy: { publishedAt: "desc" },
            take: 15,
            include: {
              podcast: {
                include: { categories: { include: { category: true } } },
              },
              mediaSources: true,
              language: true,
            },
          });

          for (const ep of semanticEpisodes) {
            if (!candidateMap.has(ep.id)) {
              candidateMap.set(ep.id, {
                ...ep,
                candidateSource: "semantic_similarity",
                matchReason: "Proche de vos récentes écoutes",
              });
            }
          }
        }
      } catch (err) {
        // Le repli continue sans bloquer
      }
    }

    // 4. Source: Derniers épisodes publiés dans le catalogue (catalogue fresh discovery)
    const latestEpisodes = await prisma.episode.findMany({
      where: {
        ...publishedFilter,
        id: { notIn: Array.from(excludedEpisodeIds) },
      },
      orderBy: { publishedAt: "desc" },
      take: 25,
      include: {
        podcast: {
          include: { categories: { include: { category: true } } },
        },
        mediaSources: true,
        language: true,
      },
    });

    for (const ep of latestEpisodes) {
      if (!candidateMap.has(ep.id) && !excludedPodcastIds.has(ep.podcastId)) {
        candidateMap.set(ep.id, {
          ...ep,
          candidateSource: "catalog_fresh",
          matchReason: "Nouveauté",
        });
      }
    }

    return Array.from(candidateMap.values()).slice(0, limit);
  }

  /**
   * Sélectionne des podcasts candidats pour la découverte d'émissions
   */
  static async selectPodcastCandidates(
    profile: UserInterestProfile | null,
    countryId = "all",
    limit = 40
  ): Promise<RecommendationCandidatePodcast[]> {
    const publishedFilter = {
      status: "PUBLISHED" as const,
      episodes: { some: { status: "PUBLISHED" as const } },
      ...(countryId !== "all" ? { countryId } : {}),
    };

    const excludedPodcastIds = new Set<string>();
    const followedPodcastIds = new Set<string>();

    if (profile?.userId) {
      const [feedback, follows] = await Promise.all([
        prisma.userContentFeedback.findMany({ where: { userId: profile.userId } }),
        prisma.podcastFollow.findMany({ where: { userId: profile.userId } }),
      ]);
      feedback.forEach((f) => {
        if (f.action === "HIDE_PODCAST" && f.podcastId) excludedPodcastIds.add(f.podcastId);
      });
      follows.forEach((f) => followedPodcastIds.add(f.podcastId));
    }

    const candidateMap = new Map<string, RecommendationCandidatePodcast>();

    // 1. Découverte affinitaire par catégorie (sans les déjà suivis)
    const topCategories = profile?.categoryScores
      ? Object.entries(profile.categoryScores)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([c]) => c)
      : [];

    if (topCategories.length > 0) {
      const affinityPodcasts = await prisma.podcast.findMany({
        where: {
          ...publishedFilter,
          id: { notIn: [...Array.from(excludedPodcastIds), ...Array.from(followedPodcastIds)] },
          categories: { some: { categoryId: { in: topCategories } } },
        },
        take: 20,
        include: {
          categories: { include: { category: true } },
          primaryLanguage: true,
          _count: { select: { episodes: { where: { status: "PUBLISHED" } }, followers: true } },
        },
      });

      for (const p of affinityPodcasts) {
        candidateMap.set(p.id, {
          ...p,
          candidateSource: "category_affinity",
          matchReason: "Selon vos centres d'intérêt",
        });
      }
    }

    // 2. Similarité sémantique avec une émission suivie
    if (followedPodcastIds.size > 0) {
      const followedSample = Array.from(followedPodcastIds).slice(0, 3);
      for (const fId of followedSample) {
        try {
          const similar = await EmbeddingService.findSimilarPodcasts(fId, 4);
          for (const s of similar) {
            if (!excludedPodcastIds.has(s.podcastId) && !followedPodcastIds.has(s.podcastId)) {
              const p = await prisma.podcast.findUnique({
                where: { id: s.podcastId, status: "PUBLISHED" },
                include: {
                  categories: { include: { category: true } },
                  primaryLanguage: true,
                  _count: { select: { episodes: { where: { status: "PUBLISHED" } }, followers: true } },
                },
              });
              if (p && !candidateMap.has(p.id)) {
                candidateMap.set(p.id, {
                  ...p,
                  candidateSource: "semantic_similarity",
                  matchReason: "Semblable à vos émissions suivies",
                });
              }
            }
          }
        } catch (_) {}
      }
    }

    // 3. Découverte générale populaire & récente
    const generalPodcasts = await prisma.podcast.findMany({
      where: {
        ...publishedFilter,
        id: { notIn: [...Array.from(excludedPodcastIds), ...Array.from(followedPodcastIds)] },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        categories: { include: { category: true } },
        primaryLanguage: true,
        _count: { select: { episodes: { where: { status: "PUBLISHED" } }, followers: true } },
      },
    });

    for (const p of generalPodcasts) {
      if (!candidateMap.has(p.id)) {
        candidateMap.set(p.id, {
          ...p,
          candidateSource: "catalog_discovery",
          matchReason: "À découvrir",
        });
      }
    }

    return Array.from(candidateMap.values()).slice(0, limit);
  }
}
