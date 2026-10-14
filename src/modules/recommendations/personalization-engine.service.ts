import { SectionSelectionService, sectionAliases, sectionTitles } from "./section-selection.service.js";
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

  private static sectionPools = new Map<string, { items: any[]; personalized: boolean; expiresAt: number }>();
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

    // Home previews and section pages share the same eligibility rules.
    // Replace the legacy arbitrary slices instead of advertising unrelated content.
    for (const [slug, [title, subtitle]] of Object.entries(sectionTitles)) {
      if (sections.some(section => section.slug === slug)) continue;
      const id = Object.keys(sectionAliases).find(id => sectionAliases[id] === slug)!;
      sections.push({ id, slug, title, subtitle, type: "EPISODE_ROW", sourceMode: "AUTOMATIC",
        position: sectionPos++, isFixedPlacement: false, priority: 50, items: [] });
    }
    const automatic = sections.filter(section => sectionTitles[section.slug] &&
      Object.prototype.hasOwnProperty.call(sectionAliases, section.id));
    for (let index = 0; index < automatic.length; index += 4) {
      await Promise.all(automatic.slice(index, index + 4).map(async section => {
        const details = await this.getSectionDetails(section.slug, {
          userId, anonymousId, countryId, category, batchId, limit: Math.max(8, section.items.length),
        });
        if (!details) throw new Error(`SECTION_SELECTION_MISSING:${section.slug}`);
        section.title = details.section.title;
        section.subtitle = details.section.subtitle;
        section.items = details.items;
        section.type = details.section.type;
        section.discoveryContext = details.section.discoveryContext;
      }));
    }
    for (let index = sections.length - 1; index >= 0; index--) {
      if (!sections[index].items.length) sections.splice(index, 1);
    }

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
          status: true,
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
      ? { AND: [{ podcast: SectionSelectionService.podcastBase(countryId, category) }] }
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

    const slug = sectionAliases[key] || key;
    const definition = sectionTitles[slug];
    if (definition) {
      let target: "EPISODE" | "PODCAST" = "EPISODE";
      let entities: any[] = [];
      let total = 0;
      let personalized = false;
      if (slug === "for-you" || slug === "discover-podcasts") {
        const poolKey = `${options.userId || "anon"}:${options.anonymousId || "none"}:${countryId || "all"}:${category || "all"}:${slug}:${options.batchId || "current"}`;
        let pool = this.sectionPools.get(poolKey);
        target = slug === "discover-podcasts" ? "PODCAST" : "EPISODE";
        if (!pool || pool.expiresAt < Date.now()) {
          const profile = options.userId ? await UserProfileService.getOrBuildProfile(options.userId) : null;
          personalized = profile?.personalizationActive === true;
          const rankingProfile = personalized ? profile : null;
          const candidates = target === "PODCAST"
            ? await CandidateSelectorService.selectPodcastCandidates(rankingProfile, countryId || "all", 200, category || "all")
            : await CandidateSelectorService.selectEpisodeCandidates(rankingProfile, countryId || "all", 200, category || "all");
          const ranked = candidates.map((entity: any) => ({ ...entity, score: target === "PODCAST"
            ? this.ranker.scorePodcast(entity, rankingProfile) : this.ranker.scoreEpisode(entity, rankingProfile) }))
            .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
          const items = target === "PODCAST" ? DiversificationService.diversifyPodcasts(ranked, 100)
            : DiversificationService.diversifyEpisodes(ranked, 3, 120);
          pool = { items, personalized, expiresAt: Date.now() + 10 * 60 * 1000 };
          if (this.sectionPools.size >= 200) this.sectionPools.delete(this.sectionPools.keys().next().value!);
          this.sectionPools.set(poolKey, pool);
        }
        personalized = pool.personalized;
        // Revalidate visibility; an old recommendation batch must not expose suspended content.
        const published = target === "PODCAST"
          ? await prisma.podcast.findMany({ where: { AND: [SectionSelectionService.podcastBase(countryId, category), { id: { in: pool.items.map(item => item.id) } }] }, include: podcastInclude })
          : await prisma.episode.findMany({ where: { status: "PUBLISHED", podcast: SectionSelectionService.podcastBase(countryId, category), id: { in: pool.items.map(item => item.id) } }, include: episodeInclude });
        const byId = new Map(published.map(item => [item.id, item]));
        const valid = pool.items.filter(item => byId.has(item.id));
        total = valid.length;
        entities = valid.slice(offset, offset + limit).map(item => byId.get(item.id));
      } else {
        const rule = (await SectionSelectionService.rule(slug, countryId, category))!;
        target = rule.target;
        if (target === "PODCAST") {
          const where = rule.where as import("@prisma/client").Prisma.PodcastWhereInput;
          [total, entities] = await Promise.all([
            prisma.podcast.count({ where }),
            prisma.podcast.findMany({ where, orderBy: slug === "popular-now"
              ? [{ followers: { _count: "desc" } }, { id: "asc" }]
              : [{ createdAt: "desc" }, { id: "asc" }], skip: offset, take: limit, include: podcastInclude }),
          ]);
        } else {
          const where = rule.where as import("@prisma/client").Prisma.EpisodeWhereInput;
          if (slug === "editorial-selection") {
            const all = await prisma.episode.findMany({ where, include: episodeInclude });
            const byId = new Map(all.map(ep => [ep.id, ep]));
            const validIds = (rule.ids || []).filter(id => byId.has(id));
            total = validIds.length;
            entities = validIds.slice(offset, offset + limit).map(id => byId.get(id));
          } else {
            [total, entities] = await Promise.all([
              prisma.episode.count({ where }),
              prisma.episode.findMany({ where, orderBy: [{ publishedAt: slug === "start-podcast" ? "asc" : "desc" }, { id: "asc" }],
                skip: offset, take: limit, include: episodeInclude }),
            ]);
          }
        }
      }
      const title = slug === "for-you" && !personalized ? "Découvertes du moment" : definition[0];
      const subtitle = slug === "for-you" && !personalized ? "Sélection de découverte ; personnalisez vos goûts pour l’affiner" : definition[1];
      return {
        section: { id: Object.keys(sectionAliases).find(id => sectionAliases[id] === slug) || slug,
          slug, title, subtitle, type: target === "PODCAST" ? "PODCAST_ROW" : "EPISODE_ROW", sourceMode: "AUTOMATIC",
          discoveryContext: { targetUrl: `/discovery/sections/${slug}?${new URLSearchParams({
            batchId, ...(category ? { category } : {}), ...(countryId ? { country: countryId } : {}),
          }).toString()}`, view: target === "PODCAST" ? "podcasts" : "episodes", label: title } },
        items: entities.map((entity, index) => ({ id: `item_${slug}_${entity.id}`, targetType: target,
          position: offset + index, reason: title,
          attribution: { batchId, engineVersion: this.ENGINE_VERSION, variant, sectionSlug: slug },
          ...(target === "PODCAST" ? { podcast: entity } : { episode: entity }) })),
        pagination: { offset, limit, total, hasMore: offset + entities.length < total },
      };
    }
    // 18. Sections éditoriales configurées en base (Prisma EditorialSection)
    const editorialSec = await prisma.editorialSection.findFirst({
      where: {
        OR: [{ id: sectionIdOrSlug }, { slug: sectionIdOrSlug }],
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
        ],
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
        if (item.episode && item.episode.podcast.status !== "PUBLISHED") return false;
        const podcast = item.podcast || item.episode?.podcast;
        if (countryId && podcast && podcast.countryId !== countryId) return false;
        if (category && podcast && !(podcast.categories || []).some((entry: any) =>
          entry.category?.id === category || entry.category?.slug === category || entry.category?.name?.toLowerCase() === category.toLowerCase())) return false;
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
        if (item.episode && item.episode.podcast.status !== "PUBLISHED") return false;
        const podcast = item.podcast || item.episode?.podcast;
        if (countryId && podcast && podcast.countryId !== countryId) return false;
        if (category && podcast && !(podcast.categories || []).some((entry: any) =>
          entry.category?.id === category || entry.category?.slug === category || entry.category?.name?.toLowerCase() === category.toLowerCase())) return false;
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
    for (const key of this.sectionPools.keys()) {
      if (!userId || key.startsWith(`${userId}:`)) this.sectionPools.delete(key);
    }
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
