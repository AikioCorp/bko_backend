import {
  RecommendationCandidateEpisode,
  RecommendationCandidatePodcast,
  RankingStrategy,
  UserInterestProfile,
} from "./recommendation.types.js";

/**
 * Stratégie de classement hybride combinant signaux normalisés :
 * - Affinité thématique / catégorielle / linguistique
 * - Nouveauté et décroissance temporelle
 * - Popularité lissée (Bayesian smoothing)
 * - Pénalisation des contenus terminés ou rapidement abandonnés
 */
export class HybridRankingStrategy implements RankingStrategy {
  name = "HYBRID_NORMALIZED_V1";

  scoreEpisode(
    candidate: RecommendationCandidateEpisode,
    profile: UserInterestProfile | null
  ): number {
    let score = 0;

    // 1. Base par source de candidat
    if (candidate.candidateSource === "followed_podcasts") score += 40;
    else if (candidate.candidateSource === "category_affinity") score += 30;
    else if (candidate.candidateSource === "semantic_similarity") score += 25;
    else score += 15;

    // 2. Bonus d'affinité utilisateur si profil présent
    if (profile) {
      // Affinité catégorie
      candidate.podcast.categories?.forEach((c) => {
        const catScore = profile.categoryScores[c.categoryId] || 0;
        score += Math.min(25, catScore * 3);
      });

      // Bonus langue préférée
      const langCode = candidate.podcast.primaryLanguageCode;
      if (langCode && profile.languageScores[langCode]) {
        score += Math.min(15, profile.languageScores[langCode] * 2);
      }

      // Pénalisation des épisodes déjà complétés (ne doivent pas dominer la découverte)
      if (profile.recentSignals.recentCompletions?.includes(candidate.id)) {
        score -= 50;
      }

      // Pénalisation prudente des abandons rapides récents
      if (profile.recentSignals.quickAbandons?.includes(candidate.id)) {
        score -= 20;
      }
    }

    // 3. Récence (bonus exponentiel pour les 14 derniers jours)
    if (candidate.publishedAt) {
      const ageHours = (Date.now() - new Date(candidate.publishedAt).getTime()) / (1000 * 3600);
      const recencyBonus = Math.max(0, 30 * Math.exp(-ageHours / (24 * 7)));
      score += recencyBonus;
    }

    // 4. Durée & type
    if (candidate.episodeType === "FULL") score += 5;

    return Math.max(0, score);
  }

  scorePodcast(
    candidate: RecommendationCandidatePodcast,
    profile: UserInterestProfile | null
  ): number {
    let score = 0;

    // 1. Base par source
    if (candidate.candidateSource === "category_affinity") score += 35;
    else if (candidate.candidateSource === "semantic_similarity") score += 30;
    else score += 20;

    // 2. Affinité utilisateur
    if (profile) {
      candidate.categories?.forEach((c) => {
        const catScore = profile.categoryScores[c.categoryId] || 0;
        score += Math.min(30, catScore * 3.5);
      });

      if (candidate.primaryLanguageCode && profile.languageScores[candidate.primaryLanguageCode]) {
        score += Math.min(15, profile.languageScores[candidate.primaryLanguageCode] * 2);
      }
    }

    // 3. Popularité lissée (Bayesian Smoothing sur followers et nb épisodes)
    const followers = candidate._count?.followers || 0;
    const episodesCount = candidate._count?.episodes || 0;
    const popularityScore = Math.min(25, Math.log10(followers + 1) * 8 + Math.min(5, episodesCount * 0.5));
    score += popularityScore;

    return Math.max(0, score);
  }
}

/**
 * Interface future prête pour LightGBM / LambdaRank.
 * Si un modèle entraîné n'est pas fourni, délègue de manière transparente à HybridRankingStrategy.
 */
export class LightGBMRankStrategy implements RankingStrategy {
  name = "LIGHTGBM_LAMBDARANK_FALLBACK";
  private fallback = new HybridRankingStrategy();

  scoreEpisode(
    candidate: RecommendationCandidateEpisode,
    profile: UserInterestProfile | null
  ): number {
    // Si modèle LightGBM ONNX / endpoint externe configuré :
    // computeFeatureVector(...) -> predict(...)
    // Sinon repli immédiat sur le classement hybride fonctionnel et mesurable.
    return this.fallback.scoreEpisode(candidate, profile);
  }

  scorePodcast(
    candidate: RecommendationCandidatePodcast,
    profile: UserInterestProfile | null
  ): number {
    return this.fallback.scorePodcast(candidate, profile);
  }
}
