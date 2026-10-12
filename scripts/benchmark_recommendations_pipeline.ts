import { prisma } from "../src/config/prisma.js";
import { PersonalizationEngineService } from "../src/modules/recommendations/personalization-engine.service.js";
import { UserProfileService } from "../src/modules/recommendations/user-profile.service.js";
import { CandidateSelectorService } from "../src/modules/recommendations/candidate-selector.service.js";
import { EmbeddingService } from "../src/modules/recommendations/embedding.service.js";
import { HybridRankingStrategy } from "../src/modules/recommendations/ranking.service.js";
import { DiversificationService } from "../src/modules/recommendations/diversification.service.js";

async function measure<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return { avg: avg.toFixed(2), p50: p50.toFixed(2), p95: p95.toFixed(2), min: min.toFixed(2), max: max.toFixed(2) };
}

async function runBenchmark() {
  console.log("===============================================================================");
  console.log("  BKO PODCAST - BENCHMARK DU SYSTÈME DE RECOMMANDATIONS ET PIPELINE D'ACCUEIL  ");
  console.log("===============================================================================");

  // 1. État du catalogue et des vecteurs
  const [totalEpisodes, totalPodcasts, totalEpVectors, totalPodVectors] = await Promise.all([
    prisma.episode.count({ where: { status: "PUBLISHED" } }),
    prisma.podcast.count({ where: { status: "PUBLISHED" } }),
    prisma.episodeEmbedding.count({ where: { status: "COMPLETED" } }),
    prisma.podcastEmbedding.count({ where: { status: "COMPLETED" } }),
  ]);

  console.log(`Catalogue : ${totalEpisodes} épisodes publiés, ${totalPodcasts} émissions publiées.`);
  console.log(`Vecteurs en base : ${totalEpVectors} EpisodeEmbeddings, ${totalPodVectors} PodcastEmbeddings.`);

  // 2. Mesure Étape A : Sélection des candidats en base (Episodes + Podcasts)
  console.log("\n--- Étape 1 : Sélection des candidats en base ---");
  const candidateDurations: number[] = [];
  for (let i = 0; i < 5; i++) {
    const { durationMs } = await measure(async () => {
      const [ep, pod] = await Promise.all([
        CandidateSelectorService.selectEpisodeCandidates(null, "all", 80),
        CandidateSelectorService.selectPodcastCandidates(null, "all", 50),
      ]);
      return { epCount: ep.length, podCount: pod.length };
    });
    candidateDurations.push(durationMs);
  }
  console.log("Latence sélection des candidats (5 itérations) :", stats(candidateDurations), "ms");

  // 3. Mesure Étape B : Recherche de similarité vectorielle
  // pgvector SQL vs In-process Cosine sur l'ensemble des vecteurs
  console.log("\n--- Étape 2 : Similarité vectorielle (pgvector SQL vs In-Process) ---");
  const sampleEp = await prisma.episodeEmbedding.findFirst({
    where: { status: "COMPLETED" },
    select: { episodeId: true, vector: true },
  });

  if (sampleEp) {
    // Mesure pgvector natif
    const pgvectorDurations: number[] = [];
    for (let i = 0; i < 5; i++) {
      const { durationMs } = await measure(async () => {
        return EmbeddingService.findSimilarEpisodes(sampleEp.episodeId, 10);
      });
      pgvectorDurations.push(durationMs);
    }
    console.log("Latence recherche pgvector SQL (k=10 sur ~5270 vecteurs) :", stats(pgvectorDurations), "ms");

    // Mesure In-Process Cosine
    const allVectors = await prisma.episodeEmbedding.findMany({
      where: { status: "COMPLETED" },
      select: { episodeId: true, vector: true },
      take: 1000,
    });
    const inProcessDurations: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const scored = allVectors.map((v) => ({
        episodeId: v.episodeId,
        similarity: EmbeddingService.cosineSimilarity(sampleEp.vector, v.vector),
      }));
      scored.sort((a, b) => b.similarity - a.similarity);
      scored.slice(0, 10);
      inProcessDurations.push(performance.now() - start);
    }
    console.log("Latence in-process dot-product (1 000 vecteurs en RAM) :", stats(inProcessDurations), "ms");
  }

  // 4. Mesure Étape C : Reconstruction du profil utilisateur
  console.log("\n--- Étape 3 : Profiling utilisateur (Rebuild profile) ---");
  const sampleUser = await prisma.user.findFirst({ select: { id: true } });
  if (sampleUser) {
    const profileDurations: number[] = [];
    for (let i = 0; i < 5; i++) {
      const { durationMs } = await measure(async () => {
        return UserProfileService.rebuildProfile(sampleUser.id);
      });
      profileDurations.push(durationMs);
    }
    console.log("Latence reconstruction de profil utilisateur :", stats(profileDurations), "ms");
  }

  // 5. Mesure Étape D : Classement (Ranking) et Diversification
  console.log("\n--- Étape 4 : Classement et diversification en mémoire ---");
  const episodes = await CandidateSelectorService.selectEpisodeCandidates(null, "all", 80);
  const podcasts = await CandidateSelectorService.selectPodcastCandidates(null, "all", 50);
  const ranker = new HybridRankingStrategy();

  const rankDiversifyDurations: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    episodes.forEach((ep) => {
      ep.score = ranker.scoreEpisode(ep, null);
    });
    episodes.sort((a, b) => (b.score || 0) - (a.score || 0));
    podcasts.forEach((p) => {
      p.score = ranker.scorePodcast(p, null);
    });
    podcasts.sort((a, b) => (b.score || 0) - (a.score || 0));
    DiversificationService.diversifyEpisodes(episodes, 2, 40);
    DiversificationService.diversifyPodcasts(podcasts, 25);
    rankDiversifyDurations.push(performance.now() - start);
  }
  console.log("Latence calcul ranking + diversification (80 eps, 50 pods) :", stats(rankDiversifyDurations), "ms");

  // 6. Mesure Étape E : Pipeline complet /home (Cold vs Warm, Anonyme vs Authentifié)
  console.log("\n--- Étape 5 : Latence bout-en-bout /home ---");
  
  // A. Visiteur Anonyme - Cache Froid
  PersonalizationEngineService.invalidateUserCache();
  const anonCold = await measure(async () => {
    return PersonalizationEngineService.getPersonalizedHome();
  });
  console.log(`Visiteur Anonyme (Cache Froid) : ${anonCold.durationMs.toFixed(2)} ms (${anonCold.result.sections.length} sections générées)`);

  // B. Visiteur Anonyme - Cache Chaud
  const anonWarm = await measure(async () => {
    return PersonalizationEngineService.getPersonalizedHome();
  });
  console.log(`Visiteur Anonyme (Cache Chaud) : ${anonWarm.durationMs.toFixed(2)} ms`);

  // C. Utilisateur Authentifié - Cache Froid
  if (sampleUser) {
    PersonalizationEngineService.invalidateUserCache(sampleUser.id);
    const authCold = await measure(async () => {
      return PersonalizationEngineService.getPersonalizedHome(sampleUser.id);
    });
    console.log(`Utilisateur Authentifié (Cache Froid) : ${authCold.durationMs.toFixed(2)} ms (${authCold.result.sections.length} sections générées)`);

    // D. Utilisateur Authentifié - Cache Chaud
    const authWarm = await measure(async () => {
      return PersonalizationEngineService.getPersonalizedHome(sampleUser.id);
    });
    console.log(`Utilisateur Authentifié (Cache Chaud) : ${authWarm.durationMs.toFixed(2)} ms`);
  }

  // 7. Mesure Étape F : Charge concurrente (5 requêtes parallèles)
  console.log("\n--- Étape 6 : Concurrence (5 requêtes simultanées) ---");
  PersonalizationEngineService.invalidateUserCache();
  const startConc = performance.now();
  const concurrentResults = await Promise.all([
    measure(() => PersonalizationEngineService.getPersonalizedHome(undefined, "anon_1")),
    measure(() => PersonalizationEngineService.getPersonalizedHome(undefined, "anon_2")),
    measure(() => PersonalizationEngineService.getPersonalizedHome(undefined, "anon_3")),
    measure(() => PersonalizationEngineService.getPersonalizedHome(sampleUser?.id, "anon_4")),
    measure(() => PersonalizationEngineService.getPersonalizedHome(sampleUser?.id, "anon_5")),
  ]);
  const totalConcTime = performance.now() - startConc;
  const durations = concurrentResults.map((r) => r.durationMs);
  console.log(`5 requêtes concurrentes exécutées en ${totalConcTime.toFixed(2)} ms au total.`);
  console.log("Statistiques individuelles par requête concurrente :", stats(durations), "ms");

  console.log("\n===============================================================================");
  console.log("  BENCHMARK TERMINÉ AVEC SUCCÈS  ");
  console.log("===============================================================================");
  await prisma.$disconnect();
}

runBenchmark().catch((e) => {
  console.error("Erreur benchmark:", e);
  process.exit(1);
});
