import { prisma } from "../../config/prisma.js";
import { UserInterestProfile } from "./recommendation.types.js";

export class UserProfileService {
  private static readonly PROFILE_TTL_MS = 60 * 60 * 1000; // 1 heure

  /**
   * Obtient ou recalcule le profil d'intérêt de l'utilisateur.
   * Combine préférences explicites (onboarding, thèmes, langues),
   * interactions (follows, saves, likes) et comportements récents (historique, écoutes).
   */
  static async getOrBuildProfile(userId: string, forceRecompute = false): Promise<UserInterestProfile | null> {
    const existing = await prisma.userRecommendationProfile.findUnique({
      where: { userId },
    });

    if (
      !forceRecompute &&
      existing &&
      Date.now() - new Date(existing.computedAt).getTime() < this.PROFILE_TTL_MS
    ) {
      return {
        userId: existing.userId,
        personalizationActive: existing.personalizationActive,
        onboardingCompleted: existing.onboardingCompleted,
        preferencesVersion: existing.preferencesVersion,
        profileVersion: existing.profileVersion,
        topicScores: (existing.topicScores as Record<string, number>) || {},
        categoryScores: (existing.categoryScores as Record<string, number>) || {},
        languageScores: (existing.languageScores as Record<string, number>) || {},
        recentSignals: (existing.recentSignals as any) || {},
        experimentVariant: existing.experimentVariant,
        computedAt: existing.computedAt,
      };
    }

    return this.rebuildProfile(userId);
  }

  /**
   * Reconstruction déterministe intégrale du profil d'intérêt à partir des données sources
   */
  static async rebuildProfile(userId: string): Promise<UserInterestProfile | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, createdAt: true },
    });
    if (!user) return null;

    // Récupération de l'ancien profil pour préserver les métadonnées et respecter le jalon de réinitialisation
    const prevProfile = await prisma.userRecommendationProfile.findUnique({ where: { userId } });
    const resetAtStr = (prevProfile?.recentSignals as any)?.resetAt;
    const resetAt = resetAtStr ? new Date(resetAtStr) : null;

    // 1. Préférences explicites
    const [topicPrefs, langPrefs, countryPrefs] = await Promise.all([
      prisma.userTopicPreference.findMany({ where: { userId }, select: { topicId: true } }),
      prisma.userLanguagePreference.findMany({ where: { userId }, select: { languageCode: true } }),
      prisma.userCountryPreference.findMany({ where: { userId }, select: { countryId: true } }),
    ]);

    // 2. Abonnements, sauvegardes, likes
    const [follows, saves, likes] = await Promise.all([
      prisma.podcastFollow.findMany({
        where: { userId },
        include: { podcast: { include: { categories: true, topics: true } } },
      }),
      prisma.savedEpisode.findMany({
        where: { userId },
        include: { episode: { include: { podcast: { include: { categories: true } }, topics: true } } },
      }),
      prisma.episodeLike.findMany({
        where: { userId },
        include: { episode: { include: { podcast: { include: { categories: true } }, topics: true } } },
      }),
    ]);

    // 3. Retours négatifs à exclure
    const negativeFeedback = await prisma.userContentFeedback.findMany({
      where: { userId },
    });
    const excludedEpisodes = new Set<string>();
    const excludedPodcasts = new Set<string>();
    for (const fb of negativeFeedback) {
      if (fb.action === "NOT_INTERESTED" || fb.action === "EXCLUDE_FROM_PROFILE") {
        if (fb.episodeId) excludedEpisodes.add(fb.episodeId);
      }
      if (fb.action === "HIDE_PODCAST" && fb.podcastId) {
        excludedPodcasts.add(fb.podcastId);
      }
    }

    // 4. Historique de lecture (30 derniers jours avec décroissance exponentielle)
    // Respecte strictement le jalon de réinitialisation non destructive (resetAt)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const minListenDate = resetAt && resetAt > thirtyDaysAgo ? resetAt : thirtyDaysAgo;

    const history = await prisma.playbackHistory.findMany({
      where: {
        userId,
        lastPlayedAt: { gte: minListenDate },
        episode: { id: { notIn: Array.from(excludedEpisodes) } },
      },
      orderBy: { lastPlayedAt: "desc" },
      take: 60,
      include: {
        episode: {
          include: {
            podcast: { include: { categories: true, topics: true } },
            topics: true,
          },
        },
      },
    });

    // 5. Sessions d'écoute réelles (exclut également les sessions antérieures à resetAt)
    const sessions = await prisma.listeningSession.findMany({
      where: { userId, startedAt: { gte: minListenDate } },
      orderBy: { lastActiveAt: "desc" },
      take: 50,
      include: {
        episode: {
          include: {
            podcast: { include: { categories: true } },
          },
        },
      },
    });

    const topicScores: Record<string, number> = {};
    const categoryScores: Record<string, number> = {};
    const languageScores: Record<string, number> = {};
    const repeatedListens: Record<string, number> = {};
    const recentCompletions: string[] = [];
    const quickAbandons: string[] = [];

    // Intégration des préférences déclarées (base solide = 3.0)
    for (const tp of topicPrefs) {
      topicScores[tp.topicId] = (topicScores[tp.topicId] || 0) + 3.0;
    }
    for (const lp of langPrefs) {
      languageScores[lp.languageCode] = (languageScores[lp.languageCode] || 0) + 3.0;
    }

    // Intégration des abonnements (+2.5 par catégorie/thème)
    for (const f of follows) {
      if (excludedPodcasts.has(f.podcastId)) continue;
      f.podcast.categories?.forEach((c) => {
        categoryScores[c.categoryId] = (categoryScores[c.categoryId] || 0) + 2.5;
      });
      f.podcast.topics?.forEach((t) => {
        topicScores[t.topicId] = (topicScores[t.topicId] || 0) + 2.0;
      });
      if (f.podcast.primaryLanguageCode) {
        languageScores[f.podcast.primaryLanguageCode] = (languageScores[f.podcast.primaryLanguageCode] || 0) + 1.5;
      }
    }

    // Intégration des sauvegardes et likes (+1.8)
    for (const s of saves) {
      if (excludedEpisodes.has(s.episodeId)) continue;
      s.episode.podcast?.categories?.forEach((c) => {
        categoryScores[c.categoryId] = (categoryScores[c.categoryId] || 0) + 1.8;
      });
      s.episode.topics?.forEach((t) => {
        topicScores[t.topicId] = (topicScores[t.topicId] || 0) + 1.5;
      });
    }
    for (const l of likes) {
      if (excludedEpisodes.has(l.episodeId)) continue;
      l.episode.podcast?.categories?.forEach((c) => {
        categoryScores[c.categoryId] = (categoryScores[c.categoryId] || 0) + 1.8;
      });
      l.episode.topics?.forEach((t) => {
        topicScores[t.topicId] = (topicScores[t.topicId] || 0) + 1.5;
      });
    }

    // Intégration pondérée de l'historique avec demi-vie de 7 jours
    const halfLifeMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (const h of history) {
      const ageMs = now - new Date(h.lastPlayedAt).getTime();
      const recencyWeight = Math.exp((-Math.LN2 * ageMs) / halfLifeMs); // 1.0 -> 0.5 à 7j -> 0.25 à 14j

      // Plafond d'influence des écoutes répétées
      const epId = h.episodeId;
      repeatedListens[epId] = (repeatedListens[epId] || 0) + 1;
      const repetitionCapWeight = Math.min(2.0, 1.0 + Math.log(repeatedListens[epId]));

      const scoreWeight = recencyWeight * repetitionCapWeight * (h.completed ? 1.5 : 1.0);

      h.episode.podcast?.categories?.forEach((c) => {
        categoryScores[c.categoryId] = (categoryScores[c.categoryId] || 0) + scoreWeight * 1.2;
      });
      h.episode.topics?.forEach((t) => {
        topicScores[t.topicId] = (topicScores[t.topicId] || 0) + scoreWeight * 1.0;
      });
      if (h.episode.languageCode) {
        languageScores[h.episode.languageCode] = (languageScores[h.episode.languageCode] || 0) + scoreWeight * 0.8;
      }

      if (h.completed && !recentCompletions.includes(epId)) {
        recentCompletions.push(epId);
      }
    }

    // Sessions d'écoute : identification prudente des abandons rapides vs écoutes qualifiées
    for (const sess of sessions) {
      if (sess.listenedSeconds < 30 && sess.positionSeconds < 30) {
        if (!quickAbandons.includes(sess.episodeId)) {
          quickAbandons.push(sess.episodeId);
        }
      } else if (sess.listenedSeconds >= 60) {
        // Renforce la catégorie
        sess.episode?.podcast?.categories?.forEach((c) => {
          categoryScores[c.categoryId] = (categoryScores[c.categoryId] || 0) + 0.5;
        });
      }
    }

    // Détermination de la variante d'expérimentation stable (hachage de userId)
    const hash = UserProfileService.hashUserId(userId);
    const experimentVariant = hash % 2 === 0 ? "control" : "variant_hybrid_v1";

    const personalizationActive = prevProfile?.personalizationActive ?? true;
    const onboardingCompleted =
      prevProfile?.onboardingCompleted ?? (topicPrefs.length > 0 || langPrefs.length > 0);
    const prefVersion = (prevProfile?.preferencesVersion ?? 1);
    const profileVersion = (prevProfile?.profileVersion ?? 0) + 1;

    const recentSignals = {
      ...(resetAtStr ? { resetAt: resetAtStr } : {}),
      lastInteractedPodcast: history[0]?.episode?.podcastId || follows[0]?.podcastId,
      lastInteractedCategory: history[0]?.episode?.podcast?.categories?.[0]?.categoryId,
      repeatedListens,
      recentCompletions: recentCompletions.slice(0, 20),
      quickAbandons: quickAbandons.slice(0, 20),
    };

    const updated = await prisma.userRecommendationProfile.upsert({
      where: { userId },
      update: {
        personalizationActive,
        onboardingCompleted,
        preferencesVersion: prefVersion,
        profileVersion,
        topicScores,
        categoryScores,
        languageScores,
        recentSignals,
        experimentVariant,
        computedAt: new Date(),
      },
      create: {
        userId,
        personalizationActive,
        onboardingCompleted,
        preferencesVersion: prefVersion,
        profileVersion,
        topicScores,
        categoryScores,
        languageScores,
        recentSignals,
        experimentVariant,
        computedAt: new Date(),
      },
    });

    return {
      userId: updated.userId,
      personalizationActive: updated.personalizationActive,
      onboardingCompleted: updated.onboardingCompleted,
      preferencesVersion: updated.preferencesVersion,
      profileVersion: updated.profileVersion,
      topicScores: (updated.topicScores as Record<string, number>) || {},
      categoryScores: (updated.categoryScores as Record<string, number>) || {},
      languageScores: (updated.languageScores as Record<string, number>) || {},
      recentSignals: (updated.recentSignals as any) || {},
      experimentVariant: updated.experimentVariant,
      computedAt: updated.computedAt,
    };
  }

  /**
   * Enregistre un retour explicite utilisateur ("Pas intéressé", "Masquer cette émission")
   */
  static async recordFeedback(
    userId: string,
    targetType: "EPISODE" | "PODCAST",
    targetId: string,
    action: "NOT_INTERESTED" | "HIDE_PODCAST" | "EXCLUDE_FROM_PROFILE"
  ) {
    const podcastId = targetType === "PODCAST" ? targetId : undefined;
    const episodeId = targetType === "EPISODE" ? targetId : undefined;

    const res = await prisma.userContentFeedback.upsert({
      where: {
        userId_targetType_podcastId_episodeId_action: {
          userId,
          targetType,
          podcastId: podcastId || "",
          episodeId: episodeId || "",
          action,
        },
      },
      update: {},
      create: {
        userId,
        targetType,
        podcastId,
        episodeId,
        action,
      },
    });

    // Invalider immédiatement le profil d'intérêt
    await this.invalidateProfile(userId);
    return res;
  }

  /**
   * Annule un retour négatif précédemment enregistré
   */
  static async removeFeedback(
    userId: string,
    targetType: "EPISODE" | "PODCAST",
    targetId: string,
    action: "NOT_INTERESTED" | "HIDE_PODCAST" | "EXCLUDE_FROM_PROFILE"
  ) {
    const podcastId = targetType === "PODCAST" ? targetId : undefined;
    const episodeId = targetType === "EPISODE" ? targetId : undefined;

    await prisma.userContentFeedback.deleteMany({
      where: {
        userId,
        targetType,
        podcastId: podcastId || null,
        episodeId: episodeId || null,
        action,
      },
    });

    await this.invalidateProfile(userId);
    return { success: true };
  }

  /**
   * Réinitialise de manière NON DESTRUCTIVE le profil de recommandation d'un utilisateur :
   * - Conserve scrupuleusement l'historique d'écoute (PlaybackHistory) pour la reprise de lecture dans le lecteur.
   * - Conserve les sessions d'écoute (ListeningSession) et les contenus masqués.
   * - Pose un jalon temporel `resetAt` : les écoutes antérieures au reset sont ignorées pour le calcul d'affinités.
   * - Remet à zéro les scores d'affinités calculés (thèmes, catégories, langues).
   * - Incrémente la version des préférences.
   */
  static async resetProfile(userId: string): Promise<UserInterestProfile | null> {
    const existing = await prisma.userRecommendationProfile.findUnique({
      where: { userId },
    });

    const resetTimestamp = new Date();
    const currentSignals = (existing?.recentSignals as any) || {};
    const updatedSignals = {
      ...currentSignals,
      resetAt: resetTimestamp.toISOString(),
    };

    const newPrefVersion = (existing?.preferencesVersion || 1) + 1;
    const newProfileVersion = (existing?.profileVersion || 0) + 1;

    await prisma.userRecommendationProfile.upsert({
      where: { userId },
      update: {
        topicScores: {},
        categoryScores: {},
        languageScores: {},
        recentSignals: updatedSignals,
        preferencesVersion: newPrefVersion,
        profileVersion: newProfileVersion,
        computedAt: resetTimestamp,
      },
      create: {
        userId,
        personalizationActive: true,
        onboardingCompleted: false,
        preferencesVersion: newPrefVersion,
        profileVersion: newProfileVersion,
        topicScores: {},
        categoryScores: {},
        languageScores: {},
        recentSignals: updatedSignals,
        computedAt: resetTimestamp,
      },
    });

    await this.invalidateProfile(userId);
    return this.rebuildProfile(userId);
  }

  /**
   * Efface l'ensemble des retours négatifs et démasque les émissions masquées (sur demande explicite)
   */
  static async clearAllFeedback(userId: string) {
    const result = await prisma.userContentFeedback.deleteMany({
      where: { userId },
    });
    await this.invalidateProfile(userId);
    return { count: result.count, success: true };
  }

  /**
   * Active ou désactive la personnalisation
   */
  static async setPersonalizationActive(userId: string, active: boolean) {
    await prisma.userRecommendationProfile.upsert({
      where: { userId },
      update: { personalizationActive: active, updatedAt: new Date() },
      create: { userId, personalizationActive: active },
    });
    await this.invalidateProfile(userId);
    return { personalizationActive: active };
  }

  /**
   * Marque l'onboarding comme complété avec enregistrement transactionnel,
   * validation des identifiants/codes et distinction entre champ omis (conserver)
   * et tableau vide (effacer explicitement).
   */
  static async completeOnboarding(
    userId: string,
    options: {
      topicIds?: string[];
      languageCodes?: string[];
      podcastIds?: string[];
    }
  ) {
    const { topicIds, languageCodes, podcastIds } = options;

    // 1. Validation & déduplication des topics
    let validatedTopicIds: string[] | undefined = undefined;
    if (topicIds !== undefined) {
      if (!Array.isArray(topicIds)) {
        throw new Error("topicIds doit être un tableau d'identifiants de sujets.");
      }
      const rawUnique = Array.from(new Set(topicIds.filter(Boolean).map(String)));
      if (rawUnique.length > 0) {
        const found = await prisma.topic.findMany({
          where: { id: { in: rawUnique } },
          select: { id: true },
        });
        const foundSet = new Set(found.map((t) => t.id));
        const invalid = rawUnique.filter((id) => !foundSet.has(id));
        if (invalid.length > 0) {
          throw new Error(`Sujets inexistants : ${invalid.slice(0, 3).join(", ")}`);
        }
        validatedTopicIds = rawUnique;
      } else {
        validatedTopicIds = [];
      }
    }

    // 2. Validation & déduplication des langues
    let validatedLangCodes: string[] | undefined = undefined;
    if (languageCodes !== undefined) {
      if (!Array.isArray(languageCodes)) {
        throw new Error("languageCodes doit être un tableau de codes de langue.");
      }
      const rawUnique = Array.from(new Set(languageCodes.filter(Boolean).map(String)));
      if (rawUnique.length > 0) {
        const found = await prisma.language.findMany({
          where: { code: { in: rawUnique } },
          select: { code: true },
        });
        const foundSet = new Set(found.map((l) => l.code));
        const invalid = rawUnique.filter((c) => !foundSet.has(c));
        if (invalid.length > 0) {
          throw new Error(`Codes de langue inexistants : ${invalid.slice(0, 3).join(", ")}`);
        }
        validatedLangCodes = rawUnique;
      } else {
        validatedLangCodes = [];
      }
    }

    // 3. Validation & déduplication des podcasts
    let validatedPodcastIds: string[] | undefined = undefined;
    if (podcastIds !== undefined) {
      if (!Array.isArray(podcastIds)) {
        throw new Error("podcastIds doit être un tableau d'identifiants d'émissions.");
      }
      const rawUnique = Array.from(new Set(podcastIds.filter(Boolean).map(String)));
      if (rawUnique.length > 0) {
        const found = await prisma.podcast.findMany({
          where: { id: { in: rawUnique } },
          select: { id: true },
        });
        const foundSet = new Set(found.map((p) => p.id));
        validatedPodcastIds = rawUnique.filter((id) => foundSet.has(id));
      } else {
        validatedPodcastIds = [];
      }
    }

    // 4. Transaction atomique
    await prisma.$transaction(async (tx) => {
      // Topics
      if (validatedTopicIds !== undefined) {
        await tx.userTopicPreference.deleteMany({ where: { userId } });
        if (validatedTopicIds.length > 0) {
          await tx.userTopicPreference.createMany({
            data: validatedTopicIds.map((topicId) => ({ userId, topicId })),
            skipDuplicates: true,
          });
        }
      }

      // Languages
      if (validatedLangCodes !== undefined) {
        await tx.userLanguagePreference.deleteMany({ where: { userId } });
        if (validatedLangCodes.length > 0) {
          await tx.userLanguagePreference.createMany({
            data: validatedLangCodes.map((languageCode) => ({ userId, languageCode })),
            skipDuplicates: true,
          });
        }
      }

      // Podcasts suivis
      if (validatedPodcastIds !== undefined && validatedPodcastIds.length > 0) {
        for (const pid of validatedPodcastIds) {
          await tx.podcastFollow.upsert({
            where: { userId_podcastId: { userId, podcastId: pid } },
            update: {},
            create: { userId, podcastId: pid },
          });
        }
      }

      // Profil de recommandation
      await tx.userRecommendationProfile.upsert({
        where: { userId },
        update: {
          onboardingCompleted: true,
          onboardingState: "COMPLETED",
          preferencesVersion: { increment: 1 },
          updatedAt: new Date(),
        },
        create: {
          userId,
          onboardingCompleted: true,
          onboardingState: "COMPLETED",
        },
      });
    });

    await this.invalidateProfile(userId);
    return this.rebuildProfile(userId);
  }

  /**
   * Met à jour l'état d'invitation (PROMPTED ou DISMISSED)
   * sans écraser un statut COMPLETED déjà acquis.
   */
  static async updateOnboardingState(userId: string, state: "PROMPTED" | "DISMISSED") {
    const existing = await prisma.userRecommendationProfile.findUnique({
      where: { userId },
      select: { onboardingState: true, onboardingCompleted: true },
    });

    if (existing?.onboardingState === "COMPLETED" || existing?.onboardingCompleted) {
      return { onboardingState: "COMPLETED" };
    }

    const data: any = {
      onboardingState: state,
      updatedAt: new Date(),
    };
    if (state === "PROMPTED") {
      data.onboardingPromptedAt = new Date();
    } else if (state === "DISMISSED") {
      data.onboardingDismissedAt = new Date();
    }

    const updated = await prisma.userRecommendationProfile.upsert({
      where: { userId },
      update: data,
      create: {
        userId,
        onboardingCompleted: false,
        ...data,
      },
    });

    return { onboardingState: updated.onboardingState };
  }

  private static invalidationListeners: Array<(userId: string) => void> = [];

  static onInvalidate(listener: (userId: string) => void) {
    this.invalidationListeners.push(listener);
  }

  /**
   * Invalide le profil pour forcer un recalcul à la prochaine requête
   */
  static async invalidateProfile(userId: string) {
    for (const listener of this.invalidationListeners) {
      try {
        listener(userId);
      } catch (_) {}
    }

    await prisma.userRecommendationProfile.updateMany({
      where: { userId },
      data: {
        preferencesVersion: { increment: 1 },
        computedAt: new Date(0), // date ancienne forçant recalcul
      },
    });
  }

  /**
   * Hachage stable pour l'affectation déterministe d'expérimentation A/B
   */
  private static hashUserId(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = (hash << 5) - hash + userId.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }
}
