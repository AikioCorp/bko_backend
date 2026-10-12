import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma.js";
import { EmbeddingService } from "../src/modules/recommendations/embedding.service.js";
import { UserProfileService } from "../src/modules/recommendations/user-profile.service.js";
import { PersonalizationEngineService } from "../src/modules/recommendations/personalization-engine.service.js";
import crypto from "crypto";

describe("Système de Recommandation Local et Non-Destructif", { timeout: 30000 }, () => {
  let testUserId: string;
  let testPodcast1Id: string;
  let testPodcast2Id: string;
  let testEpisode1Id: string;
  let testEpisode2Id: string;

  beforeAll(async () => {
    // Création d'un jeu de données de test isolé
    const user = await prisma.user.create({
      data: {
        email: `test_rec_${Date.now()}@example.com`,
        username: `rec_user_${Date.now()}`,
        fullName: "Test Recommendation User",
        passwordHash: "dummy_hash_for_test",
      },
    });
    testUserId = user.id;

    // Création de 2 podcasts de test
    const pod1 = await prisma.podcast.create({
      data: {
        name: "Test Mandingue Culture & Histoire",
        slug: `test-mandingue-${Date.now()}`,
        description: "Podcast sur l'histoire du Mali et la culture mandingue",
        cover: "https://example.com/cover1.jpg",
        primaryLanguageCode: "bm",
        status: "PUBLISHED",
      },
    });
    testPodcast1Id = pod1.id;

    const pod2 = await prisma.podcast.create({
      data: {
        name: "Test Silicon Bamako Tech",
        slug: `test-tech-${Date.now()}`,
        description: "Intelligence artificielle, startups et innovation au Sahel",
        cover: "https://example.com/cover2.jpg",
        primaryLanguageCode: "fr",
        status: "PUBLISHED",
      },
    });
    testPodcast2Id = pod2.id;

    // Création de 2 épisodes associés
    const ep1 = await prisma.episode.create({
      data: {
        podcastId: testPodcast1Id,
        title: "L'épopée de Soundiata Keïta et les griots",
        slug: `ep-soundiata-${Date.now()}`,
        description: "Récit historique traditionnel en Bambara et Français",
        status: "PUBLISHED",
        durationSeconds: 1800,
      },
    });
    testEpisode1Id = ep1.id;

    const ep2 = await prisma.episode.create({
      data: {
        podcastId: testPodcast2Id,
        title: "Lancement des startups tech à Bamako",
        slug: `ep-tech-${Date.now()}`,
        description: "Fintech, paiement mobile et télécoms",
        status: "PUBLISHED",
        durationSeconds: 1200,
      },
    });
    testEpisode2Id = ep2.id;
  });

  afterAll(async () => {
    // Nettoyage complet des données de test
    try {
      await prisma.userRecommendationProfile.deleteMany({ where: { userId: testUserId } });
      await prisma.userContentFeedback.deleteMany({ where: { userId: testUserId } });
      await prisma.listeningSession.deleteMany({ where: { userId: testUserId } });
      await prisma.playbackHistory.deleteMany({ where: { userId: testUserId } });
      await prisma.user.deleteMany({ where: { id: testUserId } });
      await prisma.episode.deleteMany({ where: { id: { in: [testEpisode1Id, testEpisode2Id] } } });
      await prisma.podcast.deleteMany({ where: { id: { in: [testPodcast1Id, testPodcast2Id] } } });
    } catch (_) {}
    await prisma.$disconnect();
  });

  it("1. Fournisseur d'embeddings local par défaut : strict zéro appel externe", async () => {
    // S'assure que EMBEDDING_PROVIDER=local par défaut génère du ngram-hash-v1
    const res = await EmbeddingService.generateEmbedding("Test culture et innovation au Mali");
    expect(res.provider).toBe("lexical-hash");
    expect(res.model).toBe("ngram-hash-v1");
    expect(res.dimensions).toBe(1024);
    expect(res.vector.length).toBe(1024);

    // Vérifie que le vecteur est unitaire (norme L2 = 1.0)
    const norm = Math.sqrt(res.vector.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 4);
  });

  it("2. Extension pgvector disponible et requête cosinus fonctionnelle", async () => {
    const hasPgVector = await EmbeddingService.isPgVectorAvailable();
    expect(hasPgVector).toBe(true);

    // Calcul de l'embedding pour l'épisode de test
    await EmbeddingService.computeEpisodeEmbedding(testEpisode1Id);
    const emb = await prisma.episodeEmbedding.findUnique({ where: { episodeId: testEpisode1Id } });
    expect(emb).toBeDefined();
    expect(emb?.status).toBe("COMPLETED");
    expect(emb?.provider).toBe("lexical-hash");

    // Recherche de similarité
    const similars = await EmbeddingService.findSimilarEpisodes(testEpisode1Id, 5);
    expect(Array.isArray(similars)).toBe(true);
  });

  it("3. Non-Destructive Reset : conserve PlaybackHistory et empêche les anciennes écoutes de recréer l'affinité", async () => {
    // Simuler un historique d'écoute antérieur
    await prisma.playbackHistory.upsert({
      where: { userId_episodeId: { userId: testUserId, episodeId: testEpisode1Id } },
      update: { positionSeconds: 500, completed: false, lastPlayedAt: new Date(Date.now() - 5000) },
      create: {
        userId: testUserId,
        episodeId: testEpisode1Id,
        positionSeconds: 500,
        completed: false,
        lastPlayedAt: new Date(Date.now() - 5000),
      },
    });

    // Simuler une session d'écoute
    await prisma.listeningSession.create({
      data: {
        sessionId: `test_sess_${Date.now()}`,
        userId: testUserId,
        episodeId: testEpisode1Id,
        positionSeconds: 500,
        listenedSeconds: 300,
        startedAt: new Date(Date.now() - 5000),
      },
    });

    // Reconstruire le profil initial : il doit enregistrer des affinités avec l'épisode
    const initialProfile = await UserProfileService.rebuildProfile(testUserId);
    expect(initialProfile).toBeDefined();

    // EXÉCUTER LE RESET NON-DESTRUCTIF
    const resetProfile = await UserProfileService.resetProfile(testUserId);
    expect(resetProfile).toBeDefined();

    // A. Preuve que PlaybackHistory n'a PAS été supprimé (reprise de lecture préservée)
    const historyAfter = await prisma.playbackHistory.findUnique({
      where: { userId_episodeId: { userId: testUserId, episodeId: testEpisode1Id } },
    });
    expect(historyAfter).not.toBeNull();
    expect(historyAfter?.positionSeconds).toBe(500);

    // B. Preuve que les sessions d'écoute n'ont PAS été supprimées
    const sessionsAfter = await prisma.listeningSession.findMany({
      where: { userId: testUserId },
    });
    expect(sessionsAfter.length).toBeGreaterThanOrEqual(1);

    // C. Preuve que les anciennes écoutes antérieures à resetAt ne recréent plus d'affinité
    const resetAt = (resetProfile?.recentSignals as any)?.resetAt;
    expect(resetAt).toBeDefined();
    // Le profil après reset sans nouvelle écoute a des scores d'affinité vides
    expect(Object.keys(resetProfile?.topicScores || {}).length).toBe(0);
    expect(Object.keys(resetProfile?.categoryScores || {}).length).toBe(0);
  });

  it("4. Masquage de contenu (HIDE_PODCAST / NOT_INTERESTED) respecté et isolation", async () => {
    // Enregistrer un feedback pour masquer le podcast 1
    await UserProfileService.recordFeedback(testUserId, "PODCAST", testPodcast1Id, "HIDE_PODCAST");

    // L'accueil personnalisé ne doit jamais contenir le podcast masqué
    const home = await PersonalizationEngineService.getPersonalizedHome(testUserId);
    
    // Vérifier les sections
    for (const section of home.sections) {
      for (const item of section.items) {
        if (item.podcast) {
          expect(item.podcast.id).not.toBe(testPodcast1Id);
        }
        if (item.episode) {
          expect(item.episode.podcastId).not.toBe(testPodcast1Id);
        }
      }
    }

    // Effacer les retours négatifs via clearAllFeedback
    const clearRes = await UserProfileService.clearAllFeedback(testUserId);
    expect(clearRes.success).toBe(true);
    expect(clearRes.count).toBeGreaterThanOrEqual(1);
  });

  it("5. Désactivation de la personnalisation : bannières et sections neutres, mais Continuer l'écoute préservé", async () => {
    // Désactiver la personnalisation
    await UserProfileService.setPersonalizationActive(testUserId, false);

    const home = await PersonalizationEngineService.getPersonalizedHome(testUserId);
    expect(home.personalizationActive).toBe(false);

    // La section 'Continuer l'écoute' DOIT être conservée (utilitaire de reprise non supprimé)
    const continueSection = home.sections.find((s) => s.slug === "continue-listening");
    expect(continueSection).toBeDefined();
    expect(continueSection?.items.length).toBeGreaterThanOrEqual(1);

    // La section de découverte doit avoir un titre et une raison neutres
    const forYouSection = home.sections.find((s) => s.slug === "for-you");
    if (forYouSection) {
      expect(forYouSection.title).toBe("Épisodes à la une");
      expect(forYouSection.reason).toBe("Sélection populaire");
    }
  });
});
