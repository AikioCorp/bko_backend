import crypto from "crypto";
import { prisma } from "../../config/prisma.js";
import {
  RecommendationBatchResponse,
  RecommendationItemDto,
  RecommendationSectionDto,
  UserInterestProfile,
} from "./recommendation.types.js";
import { UserProfileService } from "./user-profile.service.js";
import { CandidateSelectorService } from "./candidate-selector.service.js";
import { HybridRankingStrategy } from "./ranking.service.js";
import { DiversificationService } from "./diversification.service.js";
import { DiscoveryService } from "../discovery/discovery.service.js";
import { HeroService } from "../discovery/hero.service.js";

interface CacheEntry {
  data: RecommendationBatchResponse;
  expiresAt: number;
  userId?: string;
}

export class PersonalizationEngineService {
  private static readonly ENGINE_VERSION = "v1.2.0";
  private static readonly CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
  private static cache = new Map<string, CacheEntry>();

  private static ranker = new HybridRankingStrategy();

  static {
    UserProfileService.onInvalidate((userId) => {
      PersonalizationEngineService.invalidateUserCache(userId);
    });
  }

  /**
   * Génère ou récupère la page d'accueil personnalisée pour un utilisateur authentifié ou anonyme.
   */
  static async getPersonalizedHome(
    userId?: string,
    anonymousId?: string,
    countryId = "all",
    category = "all",
    cursor?: string,
    heroOptions: { refresh?: boolean; previousIds?: string[] } = {}
  ): Promise<RecommendationBatchResponse> {
    const cacheKey = `home:${userId || "anon"}:${anonymousId || "none"}:${countryId}:${category}:${cursor || "0"}`;
    const cached = this.cache.get(cacheKey);
    if (!heroOptions.refresh && cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    // 1. Profil utilisateur si connecté
    let profile: UserInterestProfile | null = null;
    if (userId) {
      try {
        profile = await UserProfileService.getOrBuildProfile(userId);
      } catch (err) {
        console.warn("[PersonalizationEngine] Impossible de charger le profil:", err);
      }
    }

    const isPersonalized = profile ? profile.personalizationActive : false;
    const variant = profile?.experimentVariant || "control";
    const batchId = `rec_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    // 2. Sections éditoriales configurées en base (actives)
    const now = new Date();
    const editorialSections = await prisma.editorialSection.findMany({
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
                primaryLanguage: true,
                categories: { include: { category: true } },
                _count: { select: { episodes: true, followers: true } },
              },
            },
            episode: {
              include: {
                podcast: true,
                mediaSources: true,
                language: true,
              },
            },
            collection: true,
          },
        },
      },
    });

    // 3. Extraction et classement des candidats dynamiques
    const [episodeCandidates, podcastCandidates] = await Promise.all([
      CandidateSelectorService.selectEpisodeCandidates(
        isPersonalized ? profile : null,
        countryId,
        80,
        category
      ),
      CandidateSelectorService.selectPodcastCandidates(
        isPersonalized ? profile : null,
        countryId,
        50,
        category
      ),
    ]);

    // Score & Tri des épisodes
    episodeCandidates.forEach((ep) => {
      ep.score = this.ranker.scoreEpisode(ep, isPersonalized ? profile : null);
    });
    episodeCandidates.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Score & Tri des podcasts
    podcastCandidates.forEach((pod) => {
      pod.score = this.ranker.scorePodcast(pod, isPersonalized ? profile : null);
    });
    podcastCandidates.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Diversification
    const diversifiedEpisodes = DiversificationService.diversifyEpisodes(episodeCandidates, 2, 40);
    const diversifiedPodcasts = DiversificationService.diversifyPodcasts(podcastCandidates, 25);

    // 4. Continuer l'écoute (disponible pour tout utilisateur connecté, même si personnalisation désactivée)
    let continueListeningItems: any[] = [];
    let newFromFollowsItems: any[] = [];

    if (userId) {
      const negativeFeedback = await prisma.userContentFeedback.findMany({
        where: { userId },
      });
      const excludedEpIds = new Set(
        negativeFeedback
          .filter((f) => (f.action === "NOT_INTERESTED" || f.action === "EXCLUDE_FROM_PROFILE") && f.episodeId)
          .map((f) => f.episodeId!)
      );
      const excludedPodIds = new Set(
        negativeFeedback.filter((f) => f.action === "HIDE_PODCAST" && f.podcastId).map((f) => f.podcastId!)
      );

      // A. Historique de reprise
      const history = await prisma.playbackHistory.findMany({
        where: {
          userId,
          completed: false,
          positionSeconds: { gt: 10 },
          episode: {
            id: { notIn: Array.from(excludedEpIds) },
            podcastId: { notIn: Array.from(excludedPodIds) },
            status: "PUBLISHED",
            podcast: { status: "PUBLISHED" },
          },
        },
        orderBy: { lastPlayedAt: "desc" },
        take: 8,
        include: {
          episode: {
            include: {
              podcast: { select: { id: true, name: true, slug: true, cover: true } },
              mediaSources: true,
              language: true,
            },
          },
        },
      });
      continueListeningItems = history.map((h) => ({
        ...h.episode,
        positionSeconds: h.positionSeconds,
        completed: h.completed,
      }));

      // B. Du nouveau dans vos émissions (suivis)
      const follows = await prisma.podcastFollow.findMany({
        where: { userId },
        select: { podcastId: true },
      });
      const followedPodIds = follows
        .map((f) => f.podcastId)
        .filter((id) => !excludedPodIds.has(id));

      if (followedPodIds.length > 0) {
        const completedHistory = await prisma.playbackHistory.findMany({
          where: { userId, completed: true },
          select: { episodeId: true },
        });
        const completedEpIds = new Set(completedHistory.map((h) => h.episodeId));

        const followEps = await prisma.episode.findMany({
          where: {
            podcastId: { in: followedPodIds },
            id: {
              notIn: [...Array.from(excludedEpIds), ...Array.from(completedEpIds)],
            },
            status: "PUBLISHED",
            podcast: { status: "PUBLISHED" },
          },
          orderBy: { publishedAt: "desc" },
          take: 12,
          include: {
            podcast: {
              select: {
                id: true,
                name: true,
                slug: true,
                cover: true,
                categories: { include: { category: true } },
              },
            },
            mediaSources: true,
            language: true,
          },
        });
        newFromFollowsItems = followEps;
      }
    }

    // 5. Assemblage des sections de la page d'accueil
    const sections: RecommendationSectionDto[] = [];
    let sectionPos = 0;

    // A. Continuer l'écoute (utilisateurs connectés ayant une lecture en cours)
    if (continueListeningItems.length > 0) {
      sections.push({
        id: "section_continue_listening",
        slug: "continue-listening",
        title: "Continuer l'écoute",
        subtitle: "Reprenez là où vous vous étiez arrêté",
        type: "EPISODE_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: true,
        priority: 100,
        reason: "Reprendre votre lecture en cours",
        discoveryContext: {
          targetUrl: "/library",
          view: "episodes",
          label: "Reprendre l'écoute",
        },
        items: continueListeningItems.map((ep, idx) => ({
          id: `item_resume_${ep.id}`,
          targetType: "EPISODE",
          position: idx,
          reason: "En cours",
          attribution: {
            batchId,
            engineVersion: this.ENGINE_VERSION,
            variant,
            sectionSlug: "continue-listening",
          },
          episode: ep,
        })),
      });
    }

    // B. Du nouveau dans vos émissions (abonnements de l'utilisateur connecté)
    if (newFromFollowsItems.length > 0) {
      sections.push({
        id: "section_new_from_follows",
        slug: "new-from-follows",
        title: "Du nouveau dans vos émissions",
        subtitle: "Les derniers épisodes des podcasts que vous suivez",
        type: "EPISODE_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: true,
        priority: 95,
        reason: "Émissions suivies",
        discoveryContext: {
          targetUrl: "/library",
          view: "episodes",
          label: "Mes abonnements",
        },
        items: newFromFollowsItems.map((ep, idx) => ({
          id: `item_follow_${ep.id}`,
          targetType: "EPISODE",
          position: idx,
          reason: `Nouvel épisode de ${ep.podcast?.name}`,
          attribution: {
            batchId,
            engineVersion: this.ENGINE_VERSION,
            variant,
            sectionSlug: "new-from-follows",
          },
          episode: ep,
        })),
      });
    }

    // C. Sections éditoriales configurées en base (MANUAL / HYBRID)
    for (const sec of editorialSections) {
      if (sec.type === "HERO") continue;

      const validItems = sec.items.filter((item) => {
        if (item.podcast && item.podcast.status !== "PUBLISHED") return false;
        if (item.episode && item.episode.status !== "PUBLISHED") return false;
        return true;
      });

      if (validItems.length > 0 || sec.sourceMode === "HYBRID") {
        const collectionSlug = validItems[0]?.collection?.slug;
        const targetUrl = collectionSlug
          ? `/discovery/sections/${collectionSlug}`
          : `/discovery/sections/${sec.slug || sec.id}`;

        const sectionItems = validItems.map((item, idx) => ({
          id: `item_ed_${item.id}`,
          targetType: (item.podcast ? "PODCAST" : "EPISODE") as "PODCAST" | "EPISODE",
          position: idx,
          reason: "Sélection éditoriale",
          attribution: {
            batchId,
            engineVersion: this.ENGINE_VERSION,
            variant,
            sectionSlug: sec.slug,
          },
          episode: item.episode || undefined,
          podcast: item.podcast || undefined,
        }));

        sections.push({
          id: sec.id,
          slug: sec.slug,
          title: sec.title,
          subtitle: sec.subtitle,
          type: sec.type,
          sourceMode: sec.sourceMode,
          position: sectionPos++,
          isFixedPlacement: sec.isFixedPlacement,
          priority: sec.priority,
          reason: "Sélection BKO Podcast",
          discoveryContext: {
            targetUrl,
            view: sec.type === "PODCAST_ROW" ? "podcasts" : (collectionSlug ? "collections" : "episodes"),
            collectionSlug,
            label: sec.title,
          },
          items: sectionItems.slice(0, sec.maxItems || 12),
        });
      }
    }

    // Récupération optimisée de compléments pour garantir les 15 sections riches
    const [shortEpsDb, longEpsDb, recentEpsDb, allPodcastsDb] = await Promise.all([
      prisma.episode.findMany({
        where: { status: "PUBLISHED", durationSeconds: { lte: 1200, gt: 0 }, podcast: { status: "PUBLISHED" } },
        take: 12,
        orderBy: { publishedAt: "desc" },
        include: { podcast: { select: { id: true, name: true, slug: true, cover: true } }, mediaSources: true, language: true },
      }),
      prisma.episode.findMany({
        where: { status: "PUBLISHED", durationSeconds: { gte: 2400 }, podcast: { status: "PUBLISHED" } },
        take: 12,
        orderBy: { publishedAt: "desc" },
        include: { podcast: { select: { id: true, name: true, slug: true, cover: true } }, mediaSources: true, language: true },
      }),
      prisma.episode.findMany({
        where: { status: "PUBLISHED", podcast: { status: "PUBLISHED" } },
        take: 14,
        orderBy: { publishedAt: "desc" },
        include: { podcast: { select: { id: true, name: true, slug: true, cover: true } }, mediaSources: true, language: true },
      }),
      prisma.podcast.findMany({
        where: { status: "PUBLISHED", episodes: { some: { status: "PUBLISHED" } } },
        take: 30,
        orderBy: { updatedAt: "desc" },
        include: {
          categories: { include: { category: true } },
          primaryLanguage: true,
          _count: { select: { episodes: true, followers: true } },
        },
      }),
    ]);

    const isFiltered = category !== "all";

    // 1. Épisodes à la une (ou Recommandé pour vous)
    const forYouEpisodes = diversifiedEpisodes.slice(0, 12);
    if (forYouEpisodes.length > 0) {
      sections.push({
        id: "section_featured_episodes",
        slug: "for-you",
        title: isFiltered
          ? `Sélection : ${category}`
          : isPersonalized
          ? "Recommandé pour vous"
          : "Épisodes à la une",
        subtitle: isFiltered
          ? "Contenus filtrés par thématique"
          : isPersonalized
          ? "Selon vos centres d'intérêt et vos dernières écoutes"
          : "Les épisodes les plus captivants du moment",
        type: "EPISODE_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: false,
        priority: 85,
        reason: isPersonalized ? "Adapté à vos goûts" : "Sélection populaire",
        discoveryContext: {
          targetUrl: isFiltered
            ? `/discovery/sections/for-you?category=${category}`
            : "/discovery/sections/for-you",
          view: "episodes",
          category: isFiltered ? category : undefined,
          sort: isPersonalized ? undefined : "popular",
          recommendationStrategy: isPersonalized ? "for-you" : undefined,
          label: isPersonalized ? "Recommandé pour vous" : "Épisodes à la une",
        },
        items: forYouEpisodes.map((ep, idx) => ({
          id: `item_foryou_${ep.id}`,
          targetType: "EPISODE",
          position: idx,
          reason: ep.matchReason || "Pour vous",
          attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "for-you" },
          episode: ep,
        })),
      });
    }

    // 2. Émissions à découvrir
    const discoverPodcasts = diversifiedPodcasts.slice(0, 10);
    if (discoverPodcasts.length > 0) {
      sections.push({
        id: "section_discover_podcasts",
        slug: "discover-podcasts",
        title: "Émissions à découvrir",
        subtitle: "Nouvelles voix et perspectives à explorer",
        type: "PODCAST_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: false,
        priority: 80,
        reason: "Découverte de séries",
        discoveryContext: {
          targetUrl: isFiltered
            ? `/discovery/sections/discover-podcasts?category=${category}`
            : "/discovery/sections/discover-podcasts",
          view: "podcasts",
          category: isFiltered ? category : undefined,
          sort: "popular",
          label: "Émissions à découvrir",
        },
        items: discoverPodcasts.map((pod, idx) => ({
          id: `item_discpod_${pod.id}`,
          targetType: "PODCAST",
          position: idx,
          reason: pod.matchReason || "Émission recommandée",
          attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "discover-podcasts" },
          podcast: pod,
        })),
      });
    }

    // 3. Nouveaux épisodes
    if (recentEpsDb.length > 0) {
      sections.push({
        id: "section_new_episodes",
        slug: "new-episodes",
        title: "Nouveaux épisodes",
        subtitle: "Les toutes dernières sorties sur la plateforme",
        type: "EPISODE_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: false,
        priority: 78,
        reason: "Nouveauté",
        discoveryContext: {
          targetUrl: isFiltered
            ? `/discovery/sections/new-episodes?category=${category}`
            : "/discovery/sections/new-episodes",
          view: "episodes",
          sort: "recent",
          label: "Nouveaux épisodes",
        },
        items: recentEpsDb.slice(0, 10).map((ep, idx) => ({
          id: `item_newep_${ep.id}`,
          targetType: "EPISODE",
          position: idx,
          reason: "Récemment publié",
          attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "new-episodes" },
          episode: ep,
        })),
      });
    }

    // 4. Populaires en ce moment
    if (allPodcastsDb.length > 0) {
      const popularPods = [...allPodcastsDb].slice(0, 10);
      sections.push({
        id: "section_popular_now",
        slug: "popular-now",
        title: "Populaires en ce moment",
        subtitle: "Les podcasts qui font l'actualité et captivent les auditeurs",
        type: "PODCAST_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: false,
        priority: 75,
        reason: "Populaire",
        discoveryContext: {
          targetUrl: "/discovery/sections/popular-now",
          view: "podcasts",
          sort: "popular",
          label: "Populaires en ce moment",
        },
        items: popularPods.map((pod, idx) => ({
          id: `item_pop_${pod.id}`,
          targetType: "PODCAST",
          position: idx,
          reason: "Populaire",
          attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "popular-now" },
          podcast: pod,
        })),
      });
    }

    // 5. Pour commencer une émission
    const starterEpisodes = [...diversifiedEpisodes].reverse().slice(0, 8);
    if (starterEpisodes.length > 0) {
      sections.push({
        id: "section_start_podcast",
        slug: "start-podcast",
        title: "Pour commencer une émission",
        subtitle: "Premiers épisodes recommandés pour entrer dans une série",
        type: "EPISODE_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: false,
        priority: 72,
        reason: "Pour démarrer",
        discoveryContext: {
          targetUrl: "/discovery/sections/start-podcast",
          view: "episodes",
          sort: "oldest",
          label: "Pour commencer",
        },
        items: starterEpisodes.map((ep, idx) => ({
          id: `item_start_${ep.id}`,
          targetType: "EPISODE",
          position: idx,
          reason: "Introduction idéale",
          attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "start-podcast" },
          episode: ep,
        })),
      });
    }

    // 6. À écouter en moins de 20 minutes
    const shortList = shortEpsDb.length > 0 ? shortEpsDb : diversifiedEpisodes.filter((e) => (e.durationSeconds || 0) <= 1200);
    if (shortList.length > 0) {
      sections.push({
        id: "section_short_episodes",
        slug: "short-episodes",
        title: "À écouter en moins de 20 minutes",
        subtitle: "Formats courts pour vos trajets et pauses rapides",
        type: "EPISODE_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: false,
        priority: 70,
        reason: "Format court",
        discoveryContext: {
          targetUrl: "/discovery/sections/short-episodes",
          view: "episodes",
          duration: "SHORT",
          label: "Moins de 20 minutes",
        },
        items: shortList.slice(0, 8).map((ep, idx) => ({
          id: `item_short_${ep.id}`,
          targetType: "EPISODE",
          position: idx,
          reason: `${Math.round((ep.durationSeconds || 600) / 60)} min`,
          attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "short-episodes" },
          episode: ep,
        })),
      });
    }

    // 7. Les formats longs à explorer
    const longList = longEpsDb.length > 0 ? longEpsDb : diversifiedEpisodes.filter((e) => (e.durationSeconds || 0) >= 2400);
    if (longList.length > 0) {
      sections.push({
        id: "section_long_episodes",
        slug: "long-episodes",
        title: "Les formats longs à explorer",
        subtitle: "Entretiens approfondis, dossiers thématiques et récits complets",
        type: "EPISODE_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: false,
        priority: 68,
        reason: "Format long",
        discoveryContext: {
          targetUrl: "/discovery/sections/long-episodes",
          view: "episodes",
          duration: "LONG",
          label: "Formats longs (> 45 min)",
        },
        items: longList.slice(0, 8).map((ep, idx) => ({
          id: `item_long_${ep.id}`,
          targetType: "EPISODE",
          position: idx,
          reason: `${Math.round((ep.durationSeconds || 2700) / 60)} min`,
          attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "long-episodes" },
          episode: ep,
        })),
      });
    }

    // 8. Des voix à découvrir
    const voicesPods = allPodcastsDb.slice(5, 15);
    if (voicesPods.length > 0) {
      sections.push({
        id: "section_voices_discover",
        slug: "voices-discover",
        title: "Des voix à découvrir",
        subtitle: "Nouveaux talents, créatrices et créateurs indépendants",
        type: "PODCAST_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: false,
        priority: 65,
        reason: "Nouvelles voix",
        discoveryContext: {
          targetUrl: "/discovery/sections/voices-discover",
          view: "podcasts",
          sort: "recent",
          label: "Des voix à découvrir",
        },
        items: voicesPods.map((pod, idx) => ({
          id: `item_voice_${pod.id}`,
          targetType: "PODCAST",
          position: idx,
          reason: "Voix singulière",
          attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "voices-discover" },
          podcast: pod,
        })),
      });
    }

    // 9. À redécouvrir
    const rediscoverEps = [...diversifiedEpisodes].slice(8, 16);
    if (rediscoverEps.length > 0) {
      sections.push({
        id: "section_rediscover",
        slug: "rediscover",
        title: "À redécouvrir",
        subtitle: "Les incontournables et pépites intemporelles de nos archives",
        type: "EPISODE_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: false,
        priority: 62,
        reason: "Archives clés",
        discoveryContext: {
          targetUrl: "/discovery/sections/rediscover",
          view: "episodes",
          sort: "oldest",
          label: "À redécouvrir",
        },
        items: rediscoverEps.map((ep, idx) => ({
          id: `item_redis_${ep.id}`,
          targetType: "EPISODE",
          position: idx,
          reason: "Grand classique",
          attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "rediscover" },
          episode: ep,
        })),
      });
    }

    // 10. Les émissions récemment arrivées sur BKO
    const recentPods = [...allPodcastsDb].slice(0, 8);
    if (recentPods.length > 0) {
      sections.push({
        id: "section_new_podcasts",
        slug: "new-podcasts",
        title: "Les émissions récemment arrivées sur BKO",
        subtitle: "Les tout derniers podcasts ajoutés au catalogue",
        type: "PODCAST_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: false,
        priority: 60,
        reason: "Arrivées récentes",
        discoveryContext: {
          targetUrl: "/discovery/sections/new-podcasts",
          view: "podcasts",
          sort: "recent",
          label: "Nouvelles émissions",
        },
        items: recentPods.map((pod, idx) => ({
          id: `item_newpod_${pod.id}`,
          targetType: "PODCAST",
          position: idx,
          reason: "Nouveau au catalogue",
          attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "new-podcasts" },
          podcast: pod,
        })),
      });
    }

    // 11. Une sélection dans une langue disponible (Bambara ou autre langue locale)
    const bamanankanEps = diversifiedEpisodes.filter((e) => e.podcast?.primaryLanguageCode === "bm" || e.language?.code === "bm");
    const langEps = bamanankanEps.length > 0 ? bamanankanEps : diversifiedEpisodes.slice(2, 8);
    const targetLangCode = bamanankanEps.length > 0 ? "bm" : "fr";
    const targetLangName = targetLangCode === "bm" ? "Bambara (Bamanankan)" : "Français";
    if (langEps.length > 0) {
      sections.push({
        id: "section_lang_selection",
        slug: "lang-selection",
        title: `Sélection en ${targetLangName}`,
        subtitle: "Écoutez des histoires et débats dans les langues du Mali",
        type: "EPISODE_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: false,
        priority: 58,
        reason: targetLangName,
        discoveryContext: {
          targetUrl: `/discovery/sections/lang-selection?lang=${targetLangCode}`,
          view: "episodes",
          language: targetLangCode,
          label: `En ${targetLangName}`,
        },
        items: langEps.slice(0, 8).map((ep, idx) => ({
          id: `item_lang_${ep.id}`,
          targetType: "EPISODE",
          position: idx,
          reason: targetLangName,
          attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "lang-selection" },
          episode: ep,
        })),
      });
    }

    // 12. Une sélection autour d'un sujet présent dans le catalogue
    const topicEps = diversifiedEpisodes.slice(4, 12);
    if (topicEps.length > 0) {
      sections.push({
        id: "section_topic_selection",
        slug: "topic-selection",
        title: "Focus thématique : Société & Culture",
        subtitle: "Épisodes explorant les transformations sociales et culturelles",
        type: "EPISODE_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: false,
        priority: 55,
        reason: "Thématique phare",
        discoveryContext: {
          targetUrl: "/discovery/sections/topic-selection",
          view: "episodes",
          category: "societe",
          label: "Société & Culture",
        },
        items: topicEps.map((ep, idx) => ({
          id: `item_topic_${ep.id}`,
          targetType: "EPISODE",
          position: idx,
          reason: "Société & Culture",
          attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "topic-selection" },
          episode: ep,
        })),
      });
    }

    // 13. Conversations et interviews à découvrir
    const interviewEps = diversifiedEpisodes.slice(1, 9);
    if (interviewEps.length > 0) {
      sections.push({
        id: "section_conversations",
        slug: "conversations-interviews",
        title: "Conversations et interviews à découvrir",
        subtitle: "Dialogues, face-à-face et récits d'expériences",
        type: "EPISODE_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: false,
        priority: 52,
        reason: "Interview & Débat",
        discoveryContext: {
          targetUrl: "/discovery/sections/conversations-interviews",
          view: "episodes",
          sort: "popular",
          label: "Conversations et interviews",
        },
        items: interviewEps.map((ep, idx) => ({
          id: `item_conv_${ep.id}`,
          targetType: "EPISODE",
          position: idx,
          reason: "Entretien marquant",
          attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "conversations-interviews" },
          episode: ep,
        })),
      });
    }

    // 14. Les émissions qui publient régulièrement
    const regularPods = allPodcastsDb.slice(3, 11);
    if (regularPods.length > 0) {
      sections.push({
        id: "section_active_podcasts",
        slug: "active-podcasts",
        title: "Les émissions qui publient régulièrement",
        subtitle: "Rendez-vous fréquents et programmes suivis avec constance",
        type: "PODCAST_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: false,
        priority: 50,
        reason: "Publication régulière",
        discoveryContext: {
          targetUrl: "/discovery/sections/active-podcasts",
          view: "podcasts",
          sort: "recent",
          label: "Émissions régulières",
        },
        items: regularPods.map((pod, idx) => ({
          id: `item_act_${pod.id}`,
          targetType: "PODCAST",
          position: idx,
          reason: "Cadence régulière",
          attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "active-podcasts" },
          podcast: pod,
        })),
      });
    }

    // 15. La sélection BKO
    const bkoSelection = diversifiedEpisodes.slice(0, 8);
    if (bkoSelection.length > 0) {
      sections.push({
        id: "section_bko_editorial",
        slug: "editorial-selection",
        title: "La sélection BKO",
        subtitle: "Nos coups de cœur choisis spécialement par la rédaction",
        type: "EPISODE_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: false,
        priority: 48,
        reason: "Coup de cœur BKO",
        discoveryContext: {
          targetUrl: "/discovery/sections/editorial-selection",
          view: "episodes",
          sort: "popular",
          label: "La sélection BKO",
        },
        items: bkoSelection.map((ep, idx) => ({
          id: `item_bko_${ep.id}`,
          targetType: "EPISODE",
          position: idx,
          reason: "Coup de cœur",
          attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "editorial-selection" },
          episode: ep,
        })),
      });
    }

    // 6. Données de tendances légères et défilement infini initial
    // Copy the shared trend cache before filtering this request's response.
    const trending = [...await DiscoveryService.getTrendingPodcasts(15, countryId).catch(() => [])];

    // Défilement infini initial (12 épisodes avec pagination)
    const feedResult = await CandidateSelectorService.selectFeedEpisodes(
      isPersonalized ? profile : null,
      countryId,
      12,
      cursor,
      category
    );

    const feed = {
      items: feedResult.items.map((ep, idx) => ({
        id: `feed_${ep.id}`,
        targetType: "EPISODE",
        position: (parseInt(cursor || "0", 10) || 0) + idx,
        reason: "À écouter",
        attribution: {
          batchId,
          engineVersion: this.ENGINE_VERSION,
          variant,
          sectionSlug: "infinite-feed",
        },
        episode: ep,
      })),
      nextCursor: feedResult.nextCursor,
      hasMore: feedResult.hasMore,
    };

    let heroSlides: any[] = [];
    try {
      // Si la personnalisation est désactivée, passer undefined pour générer une bannière neutre (populaire / nouveautés)
      heroSlides = await HeroService.build(
        isPersonalized ? userId : undefined,
        diversifiedEpisodes,
        trending,
        {
          previousIds: heroOptions.previousIds,
          seed: heroOptions.refresh ? crypto.randomUUID() : undefined,
        }
      );
    } catch (_) {
      heroSlides = [];
    }

    // Editorial, history and hero pools are not all built by the category
    // candidate selector. Apply the same constraint to the entire home response.
    if (category !== "all") {
      const podcastIds = new Set<string>();
      const podcastIdOf = (value: any) => value?.podcastId || value?.podcast?.id;
      for (const section of sections) {
        for (const item of section.items) {
          const id = item.podcast?.id || podcastIdOf(item.episode);
          if (id) podcastIds.add(id);
        }
      }
      for (const slide of heroSlides) {
        const id = podcastIdOf(slide.episode);
        if (id) podcastIds.add(id);
      }
      for (const episode of diversifiedEpisodes) {
        const id = podcastIdOf(episode);
        if (id) podcastIds.add(id);
      }
      for (const podcast of trending) podcastIds.add(podcast.id);
      const eligible = await prisma.podcast.findMany({
        where: {
          id: { in: [...podcastIds] },
          status: "PUBLISHED",
          categories: { some: { category: { OR: [
            { id: category }, { slug: category },
            { name: { equals: category, mode: "insensitive" } },
          ] } } },
        },
        select: { id: true },
      });
      const allowed = new Set(eligible.map(p => p.id));
      for (const section of sections) {
        section.items = section.items.filter(item =>
          allowed.has(item.podcast?.id || podcastIdOf(item.episode)));
      }
      for (let i = sections.length - 1; i >= 0; i--) {
        if (!sections[i].items.length) sections.splice(i, 1);
      }
      heroSlides = heroSlides.filter(slide => allowed.has(podcastIdOf(slide.episode)));
      for (let i = diversifiedEpisodes.length - 1; i >= 0; i--) {
        if (!allowed.has(podcastIdOf(diversifiedEpisodes[i]))) diversifiedEpisodes.splice(i, 1);
      }
      for (let i = trending.length - 1; i >= 0; i--) {
        if (!allowed.has(trending[i].id)) trending.splice(i, 1);
      }
    }

    const heroEpisode = heroSlides[0]?.episode || diversifiedEpisodes[0] || null;

    // 7. Enregistrement asynchrone du lot (Batch) pour suivi et attribution sans bloquer
    void this.persistBatchRecord(batchId, userId, anonymousId, variant);

    const response: RecommendationBatchResponse = {
      batchId,
      engineVersion: this.ENGINE_VERSION,
      variant,
      personalizationActive: isPersonalized,
      sections,
      heroSlides,
      heroEpisode,
      trending,
      latestEpisodes: diversifiedEpisodes.slice(0, 24),
      categoryShelves: [], // Allégé : Les catégories en bas sont supprimées pour des performances ultra-rapides
      feed,
    };

    // Mise en cache
    if (!heroOptions.refresh) this.cache.set(cacheKey, {
      data: response,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
      userId,
    });

    return response;
  }

  /**
   * Récupère uniquement la suite paginée du flux (Infinite Scroll)
   */
  static async getFeed(
    userId?: string,
    anonymousId?: string,
    countryId = "all",
    category = "all",
    cursor?: string,
    limit = 12
  ) {
    let profile: UserInterestProfile | null = null;
    if (userId) {
      try {
        profile = await UserProfileService.getOrBuildProfile(userId);
      } catch (_) {}
    }
    const isPersonalized = profile ? profile.personalizationActive : false;
    const batchId = `rec_feed_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const variant = profile?.experimentVariant || "control";

    const feedResult = await CandidateSelectorService.selectFeedEpisodes(
      isPersonalized ? profile : null,
      countryId,
      limit,
      cursor,
      category
    );

    const offsetNum = cursor ? parseInt(cursor, 10) || 0 : 0;
    return {
      batchId,
      items: feedResult.items.map((ep, idx) => ({
        id: `feed_${ep.id}`,
        targetType: "EPISODE",
        position: offsetNum + idx,
        reason: "À écouter",
        attribution: {
          batchId,
          engineVersion: this.ENGINE_VERSION,
          variant,
          sectionSlug: "infinite-feed",
        },
        episode: ep,
      })),
      nextCursor: feedResult.nextCursor,
      hasMore: feedResult.hasMore,
    };
  }

  /**
   * Récupère le détail paginé d'une section spécifique d'accueil (prolongement de rayon dédié)
   */
  static async getSectionDetails(
    sectionIdOrSlug: string,
    options: {
      userId?: string;
      anonymousId?: string;
      countryId?: string;
      category?: string;
      offset?: number;
      limit?: number;
      batchId?: string;
    } = {}
  ): Promise<{
    section: {
      id: string;
      slug: string;
      title: string;
      subtitle?: string | null;
      type: string;
      sourceMode: string;
      discoveryContext?: any;
    };
    items: RecommendationItemDto[];
    pagination: {
      offset: number;
      limit: number;
      total: number;
      hasMore: boolean;
    };
  } | null> {
    const rawOffset = options.offset ?? 0;
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    const rawLimit = options.limit ?? 20;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20;
    const category = options.category && options.category !== "all" ? options.category : undefined;
    const countryId = options.countryId && options.countryId !== "all" ? options.countryId : undefined;
    const batchId = options.batchId || `sec_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const variant = "control";

    const key = sectionIdOrSlug.toLowerCase().trim();

    const episodeInclude = {
      podcast: {
        select: {
          id: true,
          name: true,
          slug: true,
          cover: true,
          primaryLanguageCode: true,
          countryId: true,
          organization: { select: { name: true, slug: true } },
          categories: { include: { category: true } },
          _count: { select: { episodes: true, followers: true } },
        },
      },
      mediaSources: true,
      language: true,
    };

    const podcastInclude = {
      primaryLanguage: true,
      categories: { include: { category: true } },
      organization: { select: { name: true, slug: true } },
      _count: { select: { episodes: true, followers: true } },
    };

    const categoryEpisodeFilter = category
      ? {
          podcast: {
            categories: {
              some: {
                category: {
                  OR: [
                    { id: category },
                    { slug: category },
                    { name: { equals: category, mode: "insensitive" as const } },
                  ],
                },
              },
            },
          },
        }
      : {};

    const categoryPodcastFilter = category
      ? {
          categories: {
            some: {
              category: {
                OR: [
                  { id: category },
                  { slug: category },
                  { name: { equals: category, mode: "insensitive" as const } },
                ],
              },
            },
          },
        }
      : {};

    // 1. Continuer l'écoute
    if (key === "continue-listening" || key === "section_continue_listening") {
      if (!options.userId) {
        return {
          section: {
            id: "section_continue_listening",
            slug: "continue-listening",
            title: "Continuer l'écoute",
            subtitle: "Reprenez là où vous vous étiez arrêté",
            type: "EPISODE_ROW",
            sourceMode: "AUTOMATIC",
          },
          items: [],
          pagination: { offset, limit, total: 0, hasMore: false },
        };
      }

      const where = {
        userId: options.userId,
        completed: false,
        positionSeconds: { gt: 10 },
        episode: {
          status: "PUBLISHED" as const,
          podcast: { status: "PUBLISHED" as const, ...(countryId ? { countryId } : {}) },
          ...categoryEpisodeFilter,
        },
      };

      const [total, history] = await Promise.all([
        prisma.playbackHistory.count({ where }),
        prisma.playbackHistory.findMany({
          where,
          orderBy: { lastPlayedAt: "desc" },
          skip: offset,
          take: limit,
          include: {
            episode: { include: episodeInclude },
          },
        }),
      ]);

      const items: RecommendationItemDto[] = history.map((h, idx) => ({
        id: `item_resume_${h.episodeId}`,
        targetType: "EPISODE",
        position: offset + idx,
        reason: "En cours",
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "continue-listening" },
        episode: {
          ...h.episode,
          positionSeconds: h.positionSeconds,
          completed: h.completed,
        },
      }));

      return {
        section: {
          id: "section_continue_listening",
          slug: "continue-listening",
          title: "Continuer l'écoute",
          subtitle: "Reprenez là où vous vous étiez arrêté",
          type: "EPISODE_ROW",
          sourceMode: "AUTOMATIC",
          discoveryContext: { targetUrl: "/library", view: "episodes", label: "Reprendre l'écoute" },
        },
        items,
        pagination: { offset, limit, total, hasMore: offset + items.length < total },
      };
    }

    // 2. Du nouveau dans vos émissions (suivis)
    if (key === "new-from-follows" || key === "section_new_from_follows") {
      if (!options.userId) {
        return {
          section: {
            id: "section_new_from_follows",
            slug: "new-from-follows",
            title: "Du nouveau dans vos émissions",
            subtitle: "Les derniers épisodes des podcasts que vous suivez",
            type: "EPISODE_ROW",
            sourceMode: "AUTOMATIC",
          },
          items: [],
          pagination: { offset, limit, total: 0, hasMore: false },
        };
      }

      const follows = await prisma.podcastFollow.findMany({
        where: { userId: options.userId },
        select: { podcastId: true },
      });
      const followedPodIds = follows.map((f) => f.podcastId);

      if (followedPodIds.length === 0) {
        return {
          section: {
            id: "section_new_from_follows",
            slug: "new-from-follows",
            title: "Du nouveau dans vos émissions",
            subtitle: "Les derniers épisodes des podcasts que vous suivez",
            type: "EPISODE_ROW",
            sourceMode: "AUTOMATIC",
          },
          items: [],
          pagination: { offset, limit, total: 0, hasMore: false },
        };
      }

      const where = {
        podcastId: { in: followedPodIds },
        status: "PUBLISHED" as const,
        podcast: { status: "PUBLISHED" as const, ...(countryId ? { countryId } : {}) },
        ...categoryEpisodeFilter,
      };

      const [total, episodes] = await Promise.all([
        prisma.episode.count({ where }),
        prisma.episode.findMany({
          where,
          orderBy: { publishedAt: "desc" },
          skip: offset,
          take: limit,
          include: episodeInclude,
        }),
      ]);

      const items: RecommendationItemDto[] = episodes.map((ep, idx) => ({
        id: `item_follow_${ep.id}`,
        targetType: "EPISODE",
        position: offset + idx,
        reason: `Nouvel épisode de ${ep.podcast?.name}`,
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "new-from-follows" },
        episode: ep,
      }));

      return {
        section: {
          id: "section_new_from_follows",
          slug: "new-from-follows",
          title: "Du nouveau dans vos émissions",
          subtitle: "Les derniers épisodes des podcasts que vous suivez",
          type: "EPISODE_ROW",
          sourceMode: "AUTOMATIC",
          discoveryContext: { targetUrl: "/library", view: "episodes", label: "Mes abonnements" },
        },
        items,
        pagination: { offset, limit, total, hasMore: offset + items.length < total },
      };
    }

    // 3. À écouter en moins de 20 minutes (short-episodes)
    if (key === "short-episodes" || key === "section_short_episodes") {
      const where = {
        status: "PUBLISHED" as const,
        durationSeconds: { lte: 1200, gt: 0 },
        podcast: { status: "PUBLISHED" as const, ...(countryId ? { countryId } : {}) },
        ...categoryEpisodeFilter,
      };

      const [total, episodes] = await Promise.all([
        prisma.episode.count({ where }),
        prisma.episode.findMany({
          where,
          orderBy: { publishedAt: "desc" },
          skip: offset,
          take: limit,
          include: episodeInclude,
        }),
      ]);

      const items: RecommendationItemDto[] = episodes.map((ep, idx) => ({
        id: `item_short_${ep.id}`,
        targetType: "EPISODE",
        position: offset + idx,
        reason: `${Math.round((ep.durationSeconds || 600) / 60)} min`,
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "short-episodes" },
        episode: ep,
      }));

      return {
        section: {
          id: "section_short_episodes",
          slug: "short-episodes",
          title: "À écouter en moins de 20 minutes",
          subtitle: "Formats courts pour vos trajets et pauses rapides",
          type: "EPISODE_ROW",
          sourceMode: "AUTOMATIC",
          discoveryContext: { targetUrl: "/explore?view=episodes&duration=SHORT", view: "episodes", duration: "SHORT", label: "Moins de 20 minutes" },
        },
        items,
        pagination: { offset, limit, total, hasMore: offset + items.length < total },
      };
    }

    // 4. Les formats longs à explorer (long-episodes)
    if (key === "long-episodes" || key === "section_long_episodes") {
      const where = {
        status: "PUBLISHED" as const,
        durationSeconds: { gte: 2400 },
        podcast: { status: "PUBLISHED" as const, ...(countryId ? { countryId } : {}) },
        ...categoryEpisodeFilter,
      };

      const [total, episodes] = await Promise.all([
        prisma.episode.count({ where }),
        prisma.episode.findMany({
          where,
          orderBy: { publishedAt: "desc" },
          skip: offset,
          take: limit,
          include: episodeInclude,
        }),
      ]);

      const items: RecommendationItemDto[] = episodes.map((ep, idx) => ({
        id: `item_long_${ep.id}`,
        targetType: "EPISODE",
        position: offset + idx,
        reason: `${Math.round((ep.durationSeconds || 2700) / 60)} min`,
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "long-episodes" },
        episode: ep,
      }));

      return {
        section: {
          id: "section_long_episodes",
          slug: "long-episodes",
          title: "Les formats longs à explorer",
          subtitle: "Entretiens approfondis, dossiers thématiques et récits complets",
          type: "EPISODE_ROW",
          sourceMode: "AUTOMATIC",
          discoveryContext: { targetUrl: "/explore?view=episodes&duration=LONG", view: "episodes", duration: "LONG", label: "Formats longs (> 40 min)" },
        },
        items,
        pagination: { offset, limit, total, hasMore: offset + items.length < total },
      };
    }

    // 5. Nouveaux épisodes (new-episodes)
    if (key === "new-episodes" || key === "section_new_episodes") {
      const where = {
        status: "PUBLISHED" as const,
        podcast: { status: "PUBLISHED" as const, ...(countryId ? { countryId } : {}) },
        ...categoryEpisodeFilter,
      };

      const [total, episodes] = await Promise.all([
        prisma.episode.count({ where }),
        prisma.episode.findMany({
          where,
          orderBy: { publishedAt: "desc" },
          skip: offset,
          take: limit,
          include: episodeInclude,
        }),
      ]);

      const items: RecommendationItemDto[] = episodes.map((ep, idx) => ({
        id: `item_newep_${ep.id}`,
        targetType: "EPISODE",
        position: offset + idx,
        reason: "Récemment publié",
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "new-episodes" },
        episode: ep,
      }));

      return {
        section: {
          id: "section_new_episodes",
          slug: "new-episodes",
          title: "Nouveaux épisodes",
          subtitle: "Les toutes dernières sorties sur la plateforme",
          type: "EPISODE_ROW",
          sourceMode: "AUTOMATIC",
          discoveryContext: { targetUrl: "/explore?view=episodes&sort=recent", view: "episodes", sort: "recent", label: "Nouveaux épisodes" },
        },
        items,
        pagination: { offset, limit, total, hasMore: offset + items.length < total },
      };
    }

    // 6. Populaires en ce moment (popular-now)
    if (key === "popular-now" || key === "section_popular_now") {
      const where = {
        status: "PUBLISHED" as const,
        episodes: { some: { status: "PUBLISHED" as const } },
        ...(countryId ? { countryId } : {}),
        ...categoryPodcastFilter,
      };

      const [total, podcasts] = await Promise.all([
        prisma.podcast.count({ where }),
        prisma.podcast.findMany({
          where,
          orderBy: [{ qualityScore: "desc" }, { updatedAt: "desc" }],
          skip: offset,
          take: limit,
          include: podcastInclude,
        }),
      ]);

      const items: RecommendationItemDto[] = podcasts.map((pod, idx) => ({
        id: `item_pop_${pod.id}`,
        targetType: "PODCAST",
        position: offset + idx,
        reason: "Populaire",
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "popular-now" },
        podcast: pod,
      }));

      return {
        section: {
          id: "section_popular_now",
          slug: "popular-now",
          title: "Populaires en ce moment",
          subtitle: "Les podcasts qui font l'actualité et captivent les auditeurs",
          type: "PODCAST_ROW",
          sourceMode: "AUTOMATIC",
          discoveryContext: { targetUrl: "/explore?view=podcasts&sort=popular", view: "podcasts", sort: "popular", label: "Populaires en ce moment" },
        },
        items,
        pagination: { offset, limit, total, hasMore: offset + items.length < total },
      };
    }

    // 7. Émissions à découvrir (discover-podcasts)
    if (key === "discover-podcasts" || key === "section_discover_podcasts") {
      const where = {
        status: "PUBLISHED" as const,
        episodes: { some: { status: "PUBLISHED" as const } },
        ...(countryId ? { countryId } : {}),
        ...categoryPodcastFilter,
      };

      const [total, podcasts] = await Promise.all([
        prisma.podcast.count({ where }),
        prisma.podcast.findMany({
          where,
          orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
          skip: offset,
          take: limit,
          include: podcastInclude,
        }),
      ]);

      const items: RecommendationItemDto[] = podcasts.map((pod, idx) => ({
        id: `item_discpod_${pod.id}`,
        targetType: "PODCAST",
        position: offset + idx,
        reason: "Émission recommandée",
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "discover-podcasts" },
        podcast: pod,
      }));

      return {
        section: {
          id: "section_discover_podcasts",
          slug: "discover-podcasts",
          title: "Émissions à découvrir",
          subtitle: "Nouvelles voix et perspectives à explorer",
          type: "PODCAST_ROW",
          sourceMode: "AUTOMATIC",
          discoveryContext: { targetUrl: "/explore?view=podcasts&sort=popular", view: "podcasts", sort: "popular", label: "Émissions à découvrir" },
        },
        items,
        pagination: { offset, limit, total, hasMore: offset + items.length < total },
      };
    }

    // 8. Des voix à découvrir (voices-discover)
    if (key === "voices-discover" || key === "section_voices_discover") {
      const where = {
        status: "PUBLISHED" as const,
        episodes: { some: { status: "PUBLISHED" as const } },
        ...(countryId ? { countryId } : {}),
        ...categoryPodcastFilter,
      };

      const [total, podcasts] = await Promise.all([
        prisma.podcast.count({ where }),
        prisma.podcast.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: offset,
          take: limit,
          include: podcastInclude,
        }),
      ]);

      const items: RecommendationItemDto[] = podcasts.map((pod, idx) => ({
        id: `item_voice_${pod.id}`,
        targetType: "PODCAST",
        position: offset + idx,
        reason: "Voix singulière",
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "voices-discover" },
        podcast: pod,
      }));

      return {
        section: {
          id: "section_voices_discover",
          slug: "voices-discover",
          title: "Des voix à découvrir",
          subtitle: "Nouveaux talents, créatrices et créateurs indépendants",
          type: "PODCAST_ROW",
          sourceMode: "AUTOMATIC",
          discoveryContext: { targetUrl: "/explore?view=podcasts&sort=recent", view: "podcasts", sort: "recent", label: "Des voix à découvrir" },
        },
        items,
        pagination: { offset, limit, total, hasMore: offset + items.length < total },
      };
    }

    // 9. Les émissions récemment arrivées (new-podcasts)
    if (key === "new-podcasts" || key === "section_new_podcasts") {
      const where = {
        status: "PUBLISHED" as const,
        episodes: { some: { status: "PUBLISHED" as const } },
        ...(countryId ? { countryId } : {}),
        ...categoryPodcastFilter,
      };

      const [total, podcasts] = await Promise.all([
        prisma.podcast.count({ where }),
        prisma.podcast.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: offset,
          take: limit,
          include: podcastInclude,
        }),
      ]);

      const items: RecommendationItemDto[] = podcasts.map((pod, idx) => ({
        id: `item_newpod_${pod.id}`,
        targetType: "PODCAST",
        position: offset + idx,
        reason: "Nouveau au catalogue",
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "new-podcasts" },
        podcast: pod,
      }));

      return {
        section: {
          id: "section_new_podcasts",
          slug: "new-podcasts",
          title: "Les émissions récemment arrivées sur BKO",
          subtitle: "Les tout derniers podcasts ajoutés au catalogue",
          type: "PODCAST_ROW",
          sourceMode: "AUTOMATIC",
          discoveryContext: { targetUrl: "/explore?view=podcasts&sort=recent", view: "podcasts", sort: "recent", label: "Nouvelles émissions" },
        },
        items,
        pagination: { offset, limit, total, hasMore: offset + items.length < total },
      };
    }

    // 10. Les émissions qui publient régulièrement (active-podcasts)
    if (key === "active-podcasts" || key === "section_active_podcasts") {
      const where = {
        status: "PUBLISHED" as const,
        episodes: { some: { status: "PUBLISHED" as const } },
        ...(countryId ? { countryId } : {}),
        ...categoryPodcastFilter,
      };

      const [total, podcasts] = await Promise.all([
        prisma.podcast.count({ where }),
        prisma.podcast.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          skip: offset,
          take: limit,
          include: podcastInclude,
        }),
      ]);

      const items: RecommendationItemDto[] = podcasts.map((pod, idx) => ({
        id: `item_act_${pod.id}`,
        targetType: "PODCAST",
        position: offset + idx,
        reason: "Cadence régulière",
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "active-podcasts" },
        podcast: pod,
      }));

      return {
        section: {
          id: "section_active_podcasts",
          slug: "active-podcasts",
          title: "Les émissions qui publient régulièrement",
          subtitle: "Rendez-vous fréquents et programmes suivis avec constance",
          type: "PODCAST_ROW",
          sourceMode: "AUTOMATIC",
          discoveryContext: { targetUrl: "/explore?view=podcasts&sort=recent", view: "podcasts", sort: "recent", label: "Émissions régulières" },
        },
        items,
        pagination: { offset, limit, total, hasMore: offset + items.length < total },
      };
    }

    // 11. Pour commencer une émission (start-podcast)
    if (key === "start-podcast" || key === "section_start_podcast") {
      const where = {
        status: "PUBLISHED" as const,
        podcast: { status: "PUBLISHED" as const, ...(countryId ? { countryId } : {}) },
        ...categoryEpisodeFilter,
      };

      const [total, episodes] = await Promise.all([
        prisma.episode.count({ where }),
        prisma.episode.findMany({
          where,
          orderBy: { publishedAt: "asc" },
          skip: offset,
          take: limit,
          include: episodeInclude,
        }),
      ]);

      const items: RecommendationItemDto[] = episodes.map((ep, idx) => ({
        id: `item_start_${ep.id}`,
        targetType: "EPISODE",
        position: offset + idx,
        reason: "Introduction idéale",
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "start-podcast" },
        episode: ep,
      }));

      return {
        section: {
          id: "section_start_podcast",
          slug: "start-podcast",
          title: "Pour commencer une émission",
          subtitle: "Premiers épisodes recommandés pour entrer dans une série",
          type: "EPISODE_ROW",
          sourceMode: "AUTOMATIC",
          discoveryContext: { targetUrl: "/explore?view=episodes&sort=oldest", view: "episodes", sort: "oldest", label: "Pour commencer" },
        },
        items,
        pagination: { offset, limit, total, hasMore: offset + items.length < total },
      };
    }

    // 12. À redécouvrir (rediscover)
    if (key === "rediscover" || key === "section_rediscover") {
      const where = {
        status: "PUBLISHED" as const,
        podcast: { status: "PUBLISHED" as const, ...(countryId ? { countryId } : {}) },
        ...categoryEpisodeFilter,
      };

      const [total, episodes] = await Promise.all([
        prisma.episode.count({ where }),
        prisma.episode.findMany({
          where,
          orderBy: { publishedAt: "asc" },
          skip: offset,
          take: limit,
          include: episodeInclude,
        }),
      ]);

      const items: RecommendationItemDto[] = episodes.map((ep, idx) => ({
        id: `item_redis_${ep.id}`,
        targetType: "EPISODE",
        position: offset + idx,
        reason: "Grand classique",
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "rediscover" },
        episode: ep,
      }));

      return {
        section: {
          id: "section_rediscover",
          slug: "rediscover",
          title: "À redécouvrir",
          subtitle: "Les incontournables et pépites intemporelles de nos archives",
          type: "EPISODE_ROW",
          sourceMode: "AUTOMATIC",
          discoveryContext: { targetUrl: "/explore?view=episodes&sort=oldest", view: "episodes", sort: "oldest", label: "À redécouvrir" },
        },
        items,
        pagination: { offset, limit, total, hasMore: offset + items.length < total },
      };
    }

    // 13. Sélection en langue locale (lang-selection)
    if (key === "lang-selection" || key === "section_lang_selection") {
      const bmWhere = {
        status: "PUBLISHED" as const,
        podcast: { status: "PUBLISHED" as const, ...(countryId ? { countryId } : {}) },
        OR: [
          { podcast: { primaryLanguageCode: "bm" } },
          { language: { code: "bm" } },
        ],
        ...categoryEpisodeFilter,
      };

      let [total, episodes] = await Promise.all([
        prisma.episode.count({ where: bmWhere }),
        prisma.episode.findMany({
          where: bmWhere,
          orderBy: { publishedAt: "desc" },
          skip: offset,
          take: limit,
          include: episodeInclude,
        }),
      ]);

      let langName = "Bambara (Bamanankan)";
      if (total === 0) {
        langName = "Français";
        const fallbackWhere = {
          status: "PUBLISHED" as const,
          podcast: { status: "PUBLISHED" as const, ...(countryId ? { countryId } : {}) },
          ...categoryEpisodeFilter,
        };
        [total, episodes] = await Promise.all([
          prisma.episode.count({ where: fallbackWhere }),
          prisma.episode.findMany({
            where: fallbackWhere,
            orderBy: { publishedAt: "desc" },
            skip: offset,
            take: limit,
            include: episodeInclude,
          }),
        ]);
      }

      const items: RecommendationItemDto[] = episodes.map((ep, idx) => ({
        id: `item_lang_${ep.id}`,
        targetType: "EPISODE",
        position: offset + idx,
        reason: langName,
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "lang-selection" },
        episode: ep,
      }));

      return {
        section: {
          id: "section_lang_selection",
          slug: "lang-selection",
          title: `Sélection en ${langName}`,
          subtitle: "Écoutez des histoires et débats dans les langues du Mali",
          type: "EPISODE_ROW",
          sourceMode: "AUTOMATIC",
          discoveryContext: { targetUrl: "/explore?view=episodes&lang=bm", view: "episodes", language: "bm", label: `En ${langName}` },
        },
        items,
        pagination: { offset, limit, total, hasMore: offset + items.length < total },
      };
    }

    // 14. Focus thématique : Société & Culture (topic-selection)
    if (key === "topic-selection" || key === "section_topic_selection") {
      const topicWhere = {
        status: "PUBLISHED" as const,
        podcast: {
          status: "PUBLISHED" as const,
          ...(countryId ? { countryId } : {}),
          categories: {
            some: {
              category: {
                OR: [
                  { slug: { in: ["societe", "culture", "societe-culture"] } },
                  { name: { contains: "Société", mode: "insensitive" as const } },
                ],
              },
            },
          },
        },
      };

      let [total, episodes] = await Promise.all([
        prisma.episode.count({ where: topicWhere }),
        prisma.episode.findMany({
          where: topicWhere,
          orderBy: { publishedAt: "desc" },
          skip: offset,
          take: limit,
          include: episodeInclude,
        }),
      ]);

      if (total === 0) {
        const fallbackWhere = {
          status: "PUBLISHED" as const,
          podcast: { status: "PUBLISHED" as const, ...(countryId ? { countryId } : {}) },
          ...categoryEpisodeFilter,
        };
        [total, episodes] = await Promise.all([
          prisma.episode.count({ where: fallbackWhere }),
          prisma.episode.findMany({
            where: fallbackWhere,
            orderBy: { publishedAt: "desc" },
            skip: offset,
            take: limit,
            include: episodeInclude,
          }),
        ]);
      }

      const items: RecommendationItemDto[] = episodes.map((ep, idx) => ({
        id: `item_topic_${ep.id}`,
        targetType: "EPISODE",
        position: offset + idx,
        reason: "Société & Culture",
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "topic-selection" },
        episode: ep,
      }));

      return {
        section: {
          id: "section_topic_selection",
          slug: "topic-selection",
          title: "Focus thématique : Société & Culture",
          subtitle: "Épisodes explorant les transformations sociales et culturelles",
          type: "EPISODE_ROW",
          sourceMode: "AUTOMATIC",
          discoveryContext: { targetUrl: "/explore?view=episodes&category=societe", view: "episodes", category: "societe", label: "Société & Culture" },
        },
        items,
        pagination: { offset, limit, total, hasMore: offset + items.length < total },
      };
    }

    // 15. Conversations et interviews (conversations-interviews)
    if (key === "conversations-interviews" || key === "section_conversations") {
      const where = {
        status: "PUBLISHED" as const,
        podcast: { status: "PUBLISHED" as const, ...(countryId ? { countryId } : {}) },
        ...categoryEpisodeFilter,
      };

      const [total, episodes] = await Promise.all([
        prisma.episode.count({ where }),
        prisma.episode.findMany({
          where,
          orderBy: { publishedAt: "desc" },
          skip: offset,
          take: limit,
          include: episodeInclude,
        }),
      ]);

      const items: RecommendationItemDto[] = episodes.map((ep, idx) => ({
        id: `item_conv_${ep.id}`,
        targetType: "EPISODE",
        position: offset + idx,
        reason: "Entretien marquant",
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "conversations-interviews" },
        episode: ep,
      }));

      return {
        section: {
          id: "section_conversations",
          slug: "conversations-interviews",
          title: "Conversations et interviews à découvrir",
          subtitle: "Dialogues, face-à-face et récits d'expériences",
          type: "EPISODE_ROW",
          sourceMode: "AUTOMATIC",
          discoveryContext: { targetUrl: "/explore?view=episodes&sort=popular", view: "episodes", sort: "popular", label: "Conversations et interviews" },
        },
        items,
        pagination: { offset, limit, total, hasMore: offset + items.length < total },
      };
    }

    // 16. La sélection BKO (editorial-selection)
    if (key === "editorial-selection" || key === "section_bko_editorial") {
      const where = {
        status: "PUBLISHED" as const,
        podcast: { status: "PUBLISHED" as const, ...(countryId ? { countryId } : {}) },
        ...categoryEpisodeFilter,
      };

      const [total, episodes] = await Promise.all([
        prisma.episode.count({ where }),
        prisma.episode.findMany({
          where,
          orderBy: { publishedAt: "desc" },
          skip: offset,
          take: limit,
          include: episodeInclude,
        }),
      ]);

      const items: RecommendationItemDto[] = episodes.map((ep, idx) => ({
        id: `item_bko_${ep.id}`,
        targetType: "EPISODE",
        position: offset + idx,
        reason: "Coup de cœur",
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "editorial-selection" },
        episode: ep,
      }));

      return {
        section: {
          id: "section_bko_editorial",
          slug: "editorial-selection",
          title: "La sélection BKO",
          subtitle: "Nos coups de cœur choisis spécialement par la rédaction",
          type: "EPISODE_ROW",
          sourceMode: "AUTOMATIC",
          discoveryContext: { targetUrl: "/explore?view=episodes&sort=popular", view: "episodes", sort: "popular", label: "La sélection BKO" },
        },
        items,
        pagination: { offset, limit, total, hasMore: offset + items.length < total },
      };
    }

    // 17. Pour vous / Recommandations (for-you)
    if (key === "for-you" || key === "section_featured_episodes") {
      let profile: UserInterestProfile | null = null;
      if (options.userId) {
        try {
          profile = await UserProfileService.getOrBuildProfile(options.userId);
        } catch (_) {}
      }
      const isPersonalized = profile?.personalizationActive ?? false;

      const where = {
        status: "PUBLISHED" as const,
        podcast: { status: "PUBLISHED" as const, ...(countryId ? { countryId } : {}) },
        ...categoryEpisodeFilter,
      };

      const [total, episodes] = await Promise.all([
        prisma.episode.count({ where }),
        prisma.episode.findMany({
          where,
          orderBy: { publishedAt: "desc" },
          skip: offset,
          take: limit,
          include: episodeInclude,
        }),
      ]);

      const title = category
        ? `Sélection : ${category}`
        : isPersonalized
        ? "Recommandé pour vous"
        : "Épisodes à la une";

      const subtitle = category
        ? "Contenus filtrés par thématique"
        : isPersonalized
        ? "Selon vos centres d'intérêt et vos dernières écoutes"
        : "Les épisodes les plus captivants du moment";

      const items: RecommendationItemDto[] = episodes.map((ep, idx) => ({
        id: `item_foryou_${ep.id}`,
        targetType: "EPISODE",
        position: offset + idx,
        reason: isPersonalized ? "Pour vous" : "À la une",
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: "for-you" },
        episode: ep,
      }));

      return {
        section: {
          id: "section_featured_episodes",
          slug: "for-you",
          title,
          subtitle,
          type: "EPISODE_ROW",
          sourceMode: "AUTOMATIC",
          discoveryContext: {
            targetUrl: category ? `/explore?view=episodes&category=${category}` : "/explore?view=episodes&sort=popular",
            view: "episodes",
            category,
            label: title,
          },
        },
        items,
        pagination: { offset, limit, total, hasMore: offset + items.length < total },
      };
    }

    // 18. Sections éditoriales configurées en base (Prisma EditorialSection)
    const editorialSec = await prisma.editorialSection.findFirst({
      where: {
        OR: [{ id: sectionIdOrSlug }, { slug: sectionIdOrSlug }],
        isActive: true,
      },
      include: {
        items: {
          orderBy: { position: "asc" },
          include: {
            podcast: { include: podcastInclude },
            episode: { include: episodeInclude },
            collection: true,
          },
        },
      },
    });

    if (editorialSec) {
      const validItems = editorialSec.items.filter((item) => {
        if (item.podcast && item.podcast.status !== "PUBLISHED") return false;
        if (item.episode && item.episode.status !== "PUBLISHED") return false;
        return true;
      });

      const paginatedItems = validItems.slice(offset, offset + limit);
      const items: RecommendationItemDto[] = paginatedItems.map((item, idx) => ({
        id: `item_ed_${item.id}`,
        targetType: (item.podcast ? "PODCAST" : "EPISODE") as "PODCAST" | "EPISODE",
        position: offset + idx,
        reason: "Sélection éditoriale",
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: editorialSec.slug },
        episode: item.episode || undefined,
        podcast: item.podcast || undefined,
      }));

      return {
        section: {
          id: editorialSec.id,
          slug: editorialSec.slug,
          title: editorialSec.title,
          subtitle: editorialSec.subtitle,
          type: editorialSec.type,
          sourceMode: editorialSec.sourceMode,
          discoveryContext: {
            targetUrl: `/explore?view=${editorialSec.type === "PODCAST_ROW" ? "podcasts" : "episodes"}`,
            view: editorialSec.type === "PODCAST_ROW" ? "podcasts" : "episodes",
            label: editorialSec.title,
          },
        },
        items,
        pagination: {
          offset,
          limit,
          total: validItems.length,
          hasMore: offset + items.length < validItems.length,
        },
      };
    }

    // 19. Collection configurée en base (Prisma Collection)
    const collection = await prisma.collection.findFirst({
      where: {
        OR: [{ id: sectionIdOrSlug }, { slug: sectionIdOrSlug }],
      },
      include: {
        items: {
          orderBy: { position: "asc" },
          include: {
            podcast: { include: podcastInclude },
            episode: { include: episodeInclude },
          },
        },
      },
    });

    if (collection) {
      const validItems = collection.items.filter((item) => {
        if (item.podcast && item.podcast.status !== "PUBLISHED") return false;
        if (item.episode && item.episode.status !== "PUBLISHED") return false;
        return true;
      });

      const paginatedItems = validItems.slice(offset, offset + limit);
      const items: RecommendationItemDto[] = paginatedItems.map((item, idx) => ({
        id: `item_col_${item.id}`,
        targetType: (item.podcast ? "PODCAST" : "EPISODE") as "PODCAST" | "EPISODE",
        position: offset + idx,
        reason: "Collection éditoriale",
        attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: collection.slug },
        episode: item.episode || undefined,
        podcast: item.podcast || undefined,
      }));

      const hasPodcasts = validItems.some((i) => !!i.podcast);
      const hasEpisodes = validItems.some((i) => !!i.episode);
      const inferredType = hasPodcasts && !hasEpisodes ? "PODCAST_ROW" : "EPISODE_ROW";

      return {
        section: {
          id: collection.id,
          slug: collection.slug,
          title: collection.title,
          subtitle: collection.description,
          type: inferredType,
          sourceMode: "MANUAL",
          discoveryContext: {
            targetUrl: `/discovery/sections/${collection.slug || collection.id}`,
            view: inferredType === "PODCAST_ROW" ? "podcasts" : "episodes",
            label: collection.title,
          },
        },
        items,
        pagination: {
          offset,
          limit,
          total: validItems.length,
          hasMore: offset + items.length < validItems.length,
        },
      };
    }

    return null;
  }

  /**
   * Invalide le cache d'accueil pour un utilisateur donné ou de manière globale
   */
  static invalidateUserCache(userId?: string) {
    if (!userId) {
      this.cache.clear();
      return;
    }
    for (const [key, entry] of this.cache.entries()) {
      if (entry.userId === userId || key.includes(userId)) {
        this.cache.delete(key);
      }
    }
  }

  private static async persistBatchRecord(
    batchId: string,
    userId?: string,
    anonymousId?: string,
    variant = "control"
  ) {
    try {
      await prisma.recommendationBatch.create({
        data: {
          batchId,
          userId,
          anonymousId,
          engineVersion: this.ENGINE_VERSION,
          variant,
        },
      });
    } catch (e) {
      // Ignorer silencieusement pour ne pas ralentir le chargement
    }
  }
}
