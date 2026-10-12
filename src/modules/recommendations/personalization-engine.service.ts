import crypto from "crypto";
import { prisma } from "../../config/prisma.js";
import {
  RecommendationBatchResponse,
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
    countryId = "all"
  ): Promise<RecommendationBatchResponse> {
    const cacheKey = `home:${userId || "anon"}:${anonymousId || "none"}:${countryId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
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
      CandidateSelectorService.selectEpisodeCandidates(isPersonalized ? profile : null, countryId, 80),
      CandidateSelectorService.selectPodcastCandidates(isPersonalized ? profile : null, countryId, 50),
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

    // 4. Continuer l'écoute (si utilisateur connecté)
    let continueListeningItems: any[] = [];
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
    }

    // 5. Assemblage des sections de la page d'accueil
    const sections: RecommendationSectionDto[] = [];
    let sectionPos = 0;

    // A. Continuer l'écoute
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

    // B. Sections éditoriales (MANUAL / HYBRID)
    for (const sec of editorialSections) {
      if (sec.type === "HERO") continue; // Hero traité en bannière séparée

      const validItems = sec.items.filter((item) => {
        if (item.podcast && item.podcast.status !== "PUBLISHED") return false;
        if (item.episode && item.episode.status !== "PUBLISHED") return false;
        return true;
      });

      if (validItems.length > 0 || sec.sourceMode === "HYBRID") {
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
          items: sectionItems.slice(0, sec.maxItems || 12),
        });
      }
    }

    // C. Pour Vous (Épisodes recommandés)
    const forYouEpisodes = diversifiedEpisodes.slice(0, 15);
    if (forYouEpisodes.length > 0) {
      sections.push({
        id: "section_for_you_episodes",
        slug: "for-you",
        title: isPersonalized ? "Recommandé pour vous" : "Épisodes à la une",
        subtitle: isPersonalized
          ? "Selon vos centres d'intérêt et vos dernières écoutes"
          : "Les épisodes les plus captivants du moment",
        type: "EPISODE_ROW",
        sourceMode: "AUTOMATIC",
        position: sectionPos++,
        isFixedPlacement: false,
        priority: 80,
        reason: isPersonalized ? "Adapté à vos goûts" : "Sélection populaire",
        items: forYouEpisodes.map((ep, idx) => ({
          id: `item_foryou_${ep.id}`,
          targetType: "EPISODE",
          position: idx,
          reason: ep.matchReason || "Pour vous",
          attribution: {
            batchId,
            engineVersion: this.ENGINE_VERSION,
            variant,
            sectionSlug: "for-you",
          },
          episode: ep,
        })),
      });
    }

    // D. Émissions à découvrir
    const discoverPodcasts = diversifiedPodcasts.slice(0, 12);
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
        priority: 70,
        reason: "Découverte de séries",
        items: discoverPodcasts.map((pod, idx) => ({
          id: `item_discpod_${pod.id}`,
          targetType: "PODCAST",
          position: idx,
          reason: pod.matchReason || "Émission recommandée",
          attribution: {
            batchId,
            engineVersion: this.ENGINE_VERSION,
            variant,
            sectionSlug: "discover-podcasts",
          },
          podcast: pod,
        })),
      });
    }

    // 6. Données de compatibilité historique (pour l'ancienne version mobile & web si requise)
    const [trending, categoryShelves] = await Promise.all([
      DiscoveryService.getTrendingPodcasts(30, countryId),
      DiscoveryService.getCategoryShelves(countryId),
    ]);

    let heroSlides: any[] = [];
    try {
      // Si la personnalisation est désactivée, passer undefined pour générer une bannière neutre (populaire / nouveautés)
      heroSlides = await HeroService.build(isPersonalized ? userId : undefined, diversifiedEpisodes, trending);
    } catch (_) {
      heroSlides = [];
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
      categoryShelves,
    };

    // Mise en cache
    this.cache.set(cacheKey, {
      data: response,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
      userId,
    });

    return response;
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
