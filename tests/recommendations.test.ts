import assert from "node:assert/strict";
import { test } from "node:test";
import { HybridRankingStrategy } from "../src/modules/recommendations/ranking.service.js";
import { DiversificationService } from "../src/modules/recommendations/diversification.service.js";
import { EmbeddingService } from "../src/modules/recommendations/embedding.service.js";
import { InteractionCollectorService } from "../src/modules/recommendations/interaction-collector.service.js";
import { RecommendationCandidateEpisode, UserInterestProfile } from "../src/modules/recommendations/recommendation.types.js";

test("recommendations: two different interest profiles receive different rankings", () => {
  const ranker = new HybridRankingStrategy();

  const profileCulture: UserInterestProfile = {
    userId: "u_culture",
    personalizationActive: true,
    onboardingCompleted: true,
    preferencesVersion: 1,
    profileVersion: 1,
    topicScores: { t_art: 10 },
    categoryScores: { cat_culture: 10, cat_tech: 0 },
    languageScores: { fr: 5 },
    recentSignals: { repeatedListens: {}, recentCompletions: [], quickAbandons: [] },
    experimentVariant: "control",
    computedAt: new Date(),
  };

  const profileTech: UserInterestProfile = {
    userId: "u_tech",
    personalizationActive: true,
    onboardingCompleted: true,
    preferencesVersion: 1,
    profileVersion: 1,
    topicScores: { t_coding: 10 },
    categoryScores: { cat_culture: 0, cat_tech: 10 },
    languageScores: { fr: 5 },
    recentSignals: { repeatedListens: {}, recentCompletions: [], quickAbandons: [] },
    experimentVariant: "control",
    computedAt: new Date(),
  };

  const episodeCulture: RecommendationCandidateEpisode = {
    id: "ep_mali_art",
    title: "Histoire et Art de Ségou",
    slug: "histoire-art-segou",
    durationSeconds: 1800,
    episodeType: "FULL",
    podcastId: "pod_culture",
    podcast: {
      id: "pod_culture",
      name: "Culture du Mali",
      slug: "culture-du-mali",
      cover: "cover.jpg",
      primaryLanguageCode: "fr",
      categories: [{ categoryId: "cat_culture" }],
    },
    candidateSource: "category_affinity",
  };

  const episodeTech: RecommendationCandidateEpisode = {
    id: "ep_ai_bamako",
    title: "L'Intelligence Artificielle à Bamako",
    slug: "ai-bamako",
    durationSeconds: 1500,
    episodeType: "FULL",
    podcastId: "pod_tech",
    podcast: {
      id: "pod_tech",
      name: "Tech Mali",
      slug: "tech-mali",
      cover: "cover.jpg",
      primaryLanguageCode: "fr",
      categories: [{ categoryId: "cat_tech" }],
    },
    candidateSource: "category_affinity",
  };

  const scoreCultureOnCulture = ranker.scoreEpisode(episodeCulture, profileCulture);
  const scoreTechOnCulture = ranker.scoreEpisode(episodeTech, profileCulture);

  const scoreCultureOnTech = ranker.scoreEpisode(episodeCulture, profileTech);
  const scoreTechOnTech = ranker.scoreEpisode(episodeTech, profileTech);

  assert.ok(scoreCultureOnCulture > scoreTechOnCulture, "Profile Culture should rank Culture episode higher");
  assert.ok(scoreTechOnTech > scoreCultureOnTech, "Profile Tech should rank Tech episode higher");
});

test("recommendations: completed episodes are down-weighted in discovery", () => {
  const ranker = new HybridRankingStrategy();

  const profileWithCompletion: UserInterestProfile = {
    userId: "u_user",
    personalizationActive: true,
    onboardingCompleted: true,
    preferencesVersion: 1,
    profileVersion: 1,
    topicScores: {},
    categoryScores: { cat_general: 5 },
    languageScores: {},
    recentSignals: { repeatedListens: {}, recentCompletions: ["ep_finished"], quickAbandons: [] },
    experimentVariant: "control",
    computedAt: new Date(),
  };

  const epFinished: RecommendationCandidateEpisode = {
    id: "ep_finished",
    title: "Épisode déjà écouté",
    slug: "ep-finished",
    durationSeconds: 1200,
    episodeType: "FULL",
    podcastId: "p1",
    podcast: { id: "p1", name: "P1", slug: "p1", cover: "", categories: [{ categoryId: "cat_general" }] },
    candidateSource: "category_affinity",
  };

  const epFresh: RecommendationCandidateEpisode = {
    id: "ep_fresh",
    title: "Épisode nouveau",
    slug: "ep-fresh",
    durationSeconds: 1200,
    episodeType: "FULL",
    podcastId: "p1",
    podcast: { id: "p1", name: "P1", slug: "p1", cover: "", categories: [{ categoryId: "cat_general" }] },
    candidateSource: "category_affinity",
  };

  const finishedScore = ranker.scoreEpisode(epFinished, profileWithCompletion);
  const freshScore = ranker.scoreEpisode(epFresh, profileWithCompletion);

  assert.ok(freshScore > finishedScore, "Fresh episode must outrank completed episode");
});

test("recommendations: diversification limits consecutive and max episodes per podcast", () => {
  const candidates: RecommendationCandidateEpisode[] = [
    { id: "e1", title: "E1", slug: "e1", durationSeconds: 100, episodeType: "FULL", podcastId: "pA", podcast: { id: "pA", name: "PA", slug: "pa", cover: "" }, candidateSource: "test" },
    { id: "e2", title: "E2", slug: "e2", durationSeconds: 100, episodeType: "FULL", podcastId: "pA", podcast: { id: "pA", name: "PA", slug: "pa", cover: "" }, candidateSource: "test" },
    { id: "e3", title: "E3", slug: "e3", durationSeconds: 100, episodeType: "FULL", podcastId: "pA", podcast: { id: "pA", name: "PA", slug: "pa", cover: "" }, candidateSource: "test" },
    { id: "e4", title: "E4", slug: "e4", durationSeconds: 100, episodeType: "FULL", podcastId: "pB", podcast: { id: "pB", name: "PB", slug: "pb", cover: "" }, candidateSource: "test" },
    { id: "e5", title: "E5", slug: "e5", durationSeconds: 100, episodeType: "FULL", podcastId: "pC", podcast: { id: "pC", name: "PC", slug: "pc", cover: "" }, candidateSource: "test" },
  ];

  const diversified = DiversificationService.diversifyEpisodes(candidates, 2, 4);

  const countPA = diversified.filter((e) => e.podcastId === "pA").length;
  assert.ok(countPA <= 2, "Cannot have more than 2 episodes from pA in first pass");
  assert.equal(diversified.length, 4);
});

test("recommendations: dense embeddings fallback correctly to cosine similarity", () => {
  const text1 = "Musique traditionnelle et kora mandingue à Bamako";
  const text2 = "Concert de kora et musique du Mali à Bamako";
  const text3 = "Technologie blockchain et intelligence artificielle dans le cloud";

  const v1 = EmbeddingService.normalizeVector([1, 0, 1, 0]);
  const v2 = EmbeddingService.normalizeVector([1, 0, 1, 0]);
  const v3 = EmbeddingService.normalizeVector([0, 1, 0, 1]);

  const simIdentical = EmbeddingService.cosineSimilarity(v1, v2);
  const simOrthogonal = EmbeddingService.cosineSimilarity(v1, v3);

  assert.equal(Math.round(simIdentical * 100) / 100, 1);
  assert.equal(Math.round(simOrthogonal * 100) / 100, 0.5); // rescaled on 0..1
});

test("interaction-collector: rejects malformed events with missing IDs", async () => {
  const result = await InteractionCollectorService.recordListeningEvents([
    {
      clientEventId: "",
      sessionId: "s1",
      episodeId: "e1",
      eventType: "progress",
      positionSeconds: 10,
      occurredAtClient: new Date().toISOString(),
    },
    {
      clientEventId: "evt_valid",
      sessionId: "",
      episodeId: "e1",
      eventType: "progress",
      positionSeconds: 10,
      occurredAtClient: new Date().toISOString(),
    },
    {
      clientEventId: "evt_valid_2",
      sessionId: "s1",
      episodeId: "",
      eventType: "progress",
      positionSeconds: 10,
      occurredAtClient: new Date().toISOString(),
    },
  ]);

  assert.equal(result.rejected, 3, "All malformed events must be rejected");
  assert.equal(result.processed, 0);
  assert.equal(result.duplicates, 0);
});

