import {
  RecommendationCandidateEpisode,
  RecommendationCandidatePodcast,
} from "./recommendation.types.js";

export class DiversificationService {
  /**
   * Diversifie une liste d'épisodes classés :
   * - Max N épisodes par podcast (par défaut 2)
   * - Pas de deux épisodes consécutifs du même podcast
   * - Déduplication par identifiant
   */
  static diversifyEpisodes(
    candidates: RecommendationCandidateEpisode[],
    maxPerPodcast = 2,
    limit = 20
  ): RecommendationCandidateEpisode[] {
    const podcastCounts = new Map<string, number>();
    const seenEpisodes = new Set<string>();
    const result: RecommendationCandidateEpisode[] = [];

    let lastPodcastId: string | null = null;

    // Première passe : respect strict des contraintes
    for (const ep of candidates) {
      if (seenEpisodes.has(ep.id)) continue;

      const pCount = podcastCounts.get(ep.podcastId) || 0;
      if (pCount >= maxPerPodcast) continue;

      // Évite l'alternance consécutive directe si d'autres options existent
      if (lastPodcastId === ep.podcastId && candidates.length > result.length + 1) {
        continue;
      }

      seenEpisodes.add(ep.id);
      podcastCounts.set(ep.podcastId, pCount + 1);
      result.push(ep);
      lastPodcastId = ep.podcastId;

      if (result.length >= limit) break;
    }

    // Deuxième passe de repli si le catalogue est peu fourni
    if (result.length < limit) {
      for (const ep of candidates) {
        if (!seenEpisodes.has(ep.id)) {
          seenEpisodes.add(ep.id);
          result.push(ep);
          if (result.length >= limit) break;
        }
      }
    }

    return result;
  }

  /**
   * Diversifie une liste de podcasts recommandés :
   * - Déduplication
   * - Alternance des catégories dominantes pour éviter un flux monotone
   */
  static diversifyPodcasts(
    candidates: RecommendationCandidatePodcast[],
    limit = 15
  ): RecommendationCandidatePodcast[] {
    const seenPodcasts = new Set<string>();
    const categoryCounts = new Map<string, number>();
    const result: RecommendationCandidatePodcast[] = [];

    for (const p of candidates) {
      if (seenPodcasts.has(p.id)) continue;

      const primaryCatId = p.categories?.[0]?.categoryId || "general";
      const catCount = categoryCounts.get(primaryCatId) || 0;

      // Limite douce à 3 podcasts par catégorie dans la même section
      if (catCount >= 3 && candidates.length > result.length + 2) {
        continue;
      }

      seenPodcasts.add(p.id);
      categoryCounts.set(primaryCatId, catCount + 1);
      result.push(p);

      if (result.length >= limit) break;
    }

    if (result.length < limit) {
      for (const p of candidates) {
        if (!seenPodcasts.has(p.id)) {
          seenPodcasts.add(p.id);
          result.push(p);
          if (result.length >= limit) break;
        }
      }
    }

    return result;
  }
}
