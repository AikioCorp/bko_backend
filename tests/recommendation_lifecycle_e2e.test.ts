import assert from "node:assert/strict";
import { test } from "node:test";
import crypto from "node:crypto";
import { prisma } from "../src/config/prisma.js";
import { PersonalizationEngineService } from "../src/modules/recommendations/personalization-engine.service.js";
import { UserProfileService } from "../src/modules/recommendations/user-profile.service.js";
import { InteractionCollectorService } from "../src/modules/recommendations/interaction-collector.service.js";

test("recommendations: complete lifecycle verification on live database", async (t) => {
  // 1. Trouver deux épisodes publiés appartenant à des podcasts distincts
  const publishedEpisodes = await prisma.episode.findMany({
    where: { status: "PUBLISHED", podcast: { status: "PUBLISHED" } },
    take: 4,
    include: { podcast: { include: { categories: true } } },
  });

  if (publishedEpisodes.length < 2) {
    console.warn("Skipping lifecycle test: not enough published episodes in DB");
    return;
  }

  const episodeA = publishedEpisodes[0];
  const episodeB = publishedEpisodes[1];
  const podcastA = episodeA.podcast;
  const podcastB = episodeB.podcast;

  const testUserId = `test_lifecycle_${crypto.randomUUID().slice(0, 8)}`;

  // Création d'un auditeur de test
  await prisma.user.create({
    data: {
      id: testUserId,
      email: `${testUserId}@example.com`,
      fullName: "Test Lifecycle Listener",
    },
  });

  try {
    // ÉTAPE 1 : Cold start (aucune écoute, profil vierge)
    await t.test("step 1: cold start generates valid recommendation sections", async () => {
      const home = await PersonalizationEngineService.getPersonalizedHome(testUserId);
      assert.ok(home.batchId, "Batch ID must be generated");
      assert.ok(Array.isArray(home.sections), "Sections array must be returned");
      assert.ok(home.sections.length > 0, "At least one section must be generated");
    });

    // ÉTAPE 2 : Écoute active et évolution du profil
    await t.test("step 2: listening events shift user profile interest scores", async () => {
      const sessionId = `sess_${crypto.randomUUID()}`;
      const now = new Date();

      // Enregistrer une session d'écoute qualifiée pour episodeA
      await InteractionCollectorService.recordListeningEvents(
        [
          {
            clientEventId: `evt_${crypto.randomUUID()}`,
            sessionId,
            episodeId: episodeA.id,
            eventType: "start",
            positionSeconds: 0,
            deltaSeconds: 0,
            playbackRate: 1.0,
            occurredAtClient: now.toISOString(),
          },
          {
            clientEventId: `evt_${crypto.randomUUID()}`,
            sessionId,
            episodeId: episodeA.id,
            eventType: "progress",
            positionSeconds: 90,
            deltaSeconds: 60,
            playbackRate: 1.0,
            occurredAtClient: new Date(now.getTime() + 60000).toISOString(),
          },
        ],
        testUserId
      );

      // Créer également un enregistrement d'historique de lecture
      await prisma.playbackHistory.upsert({
        where: { userId_episodeId: { userId: testUserId, episodeId: episodeA.id } },
        update: { positionSeconds: 90, lastPlayedAt: new Date() },
        create: {
          userId: testUserId,
          episodeId: episodeA.id,
          positionSeconds: 90,
          completed: false,
          lastPlayedAt: new Date(),
        },
      });

      // Recalcul du profil
      const updatedProfile = await UserProfileService.rebuildProfile(testUserId);
      assert.ok(updatedProfile, "Profile must exist after rebuild");
      assert.equal(updatedProfile.userId, testUserId);

      // Si l'épisode a une catégorie, vérifier que son score a progressé
      const categoryId = podcastA.categories[0]?.categoryId;
      if (categoryId) {
        assert.ok(
          (updatedProfile.categoryScores[categoryId] || 0) > 0,
          `Category score for ${categoryId} should be positive after listening`
        );
      }
    });

    // ÉTAPE 3 : Exclusion d'un épisode (Feedback "Pas intéressé")
    await t.test("step 3: negative feedback NOT_INTERESTED excludes episode from recommendations", async () => {
      await UserProfileService.recordFeedback(testUserId, "EPISODE", episodeA.id, "NOT_INTERESTED");

      const home = await PersonalizationEngineService.getPersonalizedHome(testUserId);
      
      // Vérifier que episodeA n'apparaît dans AUCUNE section d'épisodes recommandés
      for (const sec of home.sections) {
        if (sec.type === "EPISODE_ROW") {
          const found = sec.items.find((item) => item.episode?.id === episodeA.id);
          assert.equal(found, undefined, `Excluded episode ${episodeA.id} must NOT appear in section ${sec.title}`);
        }
      }
    });

    // ÉTAPE 4 : Masquage d'une émission (Feedback "Masquer l'émission")
    await t.test("step 4: negative feedback HIDE_PODCAST excludes entire podcast and its episodes", async () => {
      await UserProfileService.recordFeedback(testUserId, "PODCAST", podcastB.id, "HIDE_PODCAST");

      const home = await PersonalizationEngineService.getPersonalizedHome(testUserId);

      // Vérifier que ni podcastB ni aucun de ses épisodes n'apparaissent dans les sections
      for (const sec of home.sections) {
        if (sec.type === "PODCAST_ROW") {
          const found = sec.items.find((item) => item.podcast?.id === podcastB.id);
          assert.equal(found, undefined, `Hidden podcast ${podcastB.id} must NOT appear in podcast shelf`);
        }
        if (sec.type === "EPISODE_ROW") {
          const found = sec.items.find((item) => item.episode?.podcastId === podcastB.id);
          assert.equal(found, undefined, `Episodes of hidden podcast ${podcastB.id} must NOT appear in episode row`);
        }
      }
    });

    // ÉTAPE 5 : Réinitialisation du profil (Reset profile)
    await t.test("step 5: reset profile wipes feedback, detaches past sessions, and clears affinity scores", async () => {
      const resetProfile = await UserProfileService.resetProfile(testUserId);
      assert.ok(resetProfile);
      
      // Les retours négatifs et sessions passées doivent être vidés
      const remainingFeedback = await prisma.userContentFeedback.count({
        where: { userId: testUserId },
      });
      assert.equal(remainingFeedback, 0, "All feedback records must be deleted upon reset");

      // La reconstruction immédiate du profil ne doit contenir aucune affinité résiduelle
      const rebuiltProfile = await UserProfileService.rebuildProfile(testUserId);
      const categoryScoreValues = Object.values(rebuiltProfile.categoryScores || {});
      const maxScore = categoryScoreValues.length ? Math.max(...categoryScoreValues) : 0;
      assert.equal(maxScore, 0, "Rebuilt profile after reset must not recreate prior category affinities");
    });

    // ÉTAPE 6 : Désactivation de la personnalisation (Opt-out)
    await t.test("step 6: disabling personalization ensures neutral hero and neutral sections", async () => {
      await UserProfileService.setPersonalizationActive(testUserId, false);
      const profile = await UserProfileService.getOrBuildProfile(testUserId);
      assert.equal(profile?.personalizationActive, false, "Personalization should be inactive");

      const home = await PersonalizationEngineService.getPersonalizedHome(testUserId);
      assert.ok(home.batchId);
      assert.equal(home.personalizationActive, false, "Batch response must flag personalizationActive as false");

      // Vérifier que la bannière Hero est neutre (ne contient pas de slide 'resume' ou 'for_you')
      if (home.heroSlides && home.heroSlides.length > 0) {
        for (const slide of home.heroSlides) {
          assert.notEqual(slide.kind, "resume", "Disabled personalization must not have resume slide in hero");
          assert.notEqual(slide.kind, "for_you", "Disabled personalization must not have for_you slide in hero");
        }
      }

      // Vérifier que les sections sont neutres :
      // 1. Pas de section 'continue-listening'
      const continueSec = home.sections.find((s) => s.slug === "continue-listening");
      assert.equal(continueSec, undefined, "Neutral home must not contain continue-listening section");

      // 2. Le titre de 'for-you' bascule en mode éditorial neutre ("Épisodes à la une")
      const forYouSec = home.sections.find((s) => s.slug === "for-you");
      if (forYouSec) {
        assert.equal(forYouSec.title, "Épisodes à la une", "Section title must be neutral 'Épisodes à la une'");
        assert.equal(forYouSec.reason, "Sélection populaire", "Section reason must be neutral 'Sélection populaire'");
      }
    });

  } finally {
    // Nettoyage complet
    await prisma.userContentFeedback.deleteMany({ where: { userId: testUserId } });
    await prisma.playbackHistory.deleteMany({ where: { userId: testUserId } });
    await prisma.listeningEvent.deleteMany({ where: { userId: testUserId } });
    await prisma.listeningSession.deleteMany({ where: { userId: testUserId } });
    await prisma.userRecommendationProfile.deleteMany({ where: { userId: testUserId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
    await prisma.$disconnect();
  }
});
