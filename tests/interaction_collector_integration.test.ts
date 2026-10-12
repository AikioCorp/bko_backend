import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../src/config/prisma.js";
import { InteractionCollectorService, PlaybackSessionEventPayload } from "../src/modules/recommendations/interaction-collector.service.js";
import crypto from "node:crypto";

test("interaction-collector: database integration tests for atomic telemetry, deduplication and ownership", async (t) => {
  // 1. Trouver un épisode existant dans la base
  const existingEpisode = await prisma.episode.findFirst({
    where: { status: "PUBLISHED" },
    select: { id: true },
  });

  if (!existingEpisode) {
    console.warn("Skipping integration test: no published episode in database");
    return;
  }

  const episodeId = existingEpisode.id;
  const userAId = `test_user_a_${crypto.randomUUID().slice(0, 8)}`;
  const userBId = `test_user_b_${crypto.randomUUID().slice(0, 8)}`;

  // Créer des utilisateurs temporaires pour le test
  await prisma.user.createMany({
    data: [
      { id: userAId, email: `${userAId}@example.com`, fullName: "Test Listener A" },
      { id: userBId, email: `${userBId}@example.com`, fullName: "Test Listener B" },
    ],
  });

  const sessionIdA = `test_session_${crypto.randomUUID()}`;
  const now = new Date();

  try {
    // TEST 1: Même événement envoyé deux fois consécutivement (déduplication)
    await t.test("deduplication: same clientEventId sent twice is processed once and does not double-count session time", async () => {
      const clientEventId = `evt_dedup_${crypto.randomUUID()}`;
      const payload: PlaybackSessionEventPayload = {
        clientEventId,
        sessionId: sessionIdA,
        episodeId,
        eventType: "progress",
        positionSeconds: 15,
        deltaSeconds: 15,
        playbackRate: 1.0,
        playSource: "home",
        occurredAtClient: new Date(now.getTime() + 1000).toISOString(),
      };

      // Premier envoi
      const res1 = await InteractionCollectorService.recordListeningEvents([payload], userAId);
      assert.equal(res1.processed, 1, "First event should be processed");
      assert.equal(res1.duplicates, 0, "First event should not be duplicate");

      const sessionAfterFirst = await prisma.listeningSession.findUnique({
        where: { sessionId: sessionIdA },
      });
      assert.ok(sessionAfterFirst, "Session should exist");
      assert.equal(sessionAfterFirst.listenedSeconds, 15, "listenedSeconds should be 15 after first event");

      // Deuxième envoi (retry avec le même clientEventId)
      const res2 = await InteractionCollectorService.recordListeningEvents([payload], userAId);
      assert.equal(res2.processed, 0, "Second identical event must not be re-processed");
      assert.equal(res2.duplicates, 1, "Second event must be flagged as duplicate");

      const sessionAfterSecond = await prisma.listeningSession.findUnique({
        where: { sessionId: sessionIdA },
      });
      assert.equal(
        sessionAfterSecond?.listenedSeconds,
        15,
        "listenedSeconds must REMAIN 15 and not be doubled upon retry"
      );
    });

    // TEST 2: Doublons envoyés simultanément (concurrence atomique)
    await t.test("concurrency: duplicate events sent simultaneously are handled atomically", async () => {
      const concurrentEventId = `evt_concurrent_${crypto.randomUUID()}`;
      const payload: PlaybackSessionEventPayload = {
        clientEventId: concurrentEventId,
        sessionId: sessionIdA,
        episodeId,
        eventType: "progress",
        positionSeconds: 30,
        deltaSeconds: 15,
        playbackRate: 1.0,
        playSource: "home",
        occurredAtClient: new Date(now.getTime() + 2000).toISOString(),
      };

      // Appel concurrent avec Promise.all
      const [r1, r2] = await Promise.all([
        InteractionCollectorService.recordListeningEvents([payload], userAId),
        InteractionCollectorService.recordListeningEvents([payload], userAId),
      ]);

      const totalProcessed = r1.processed + r2.processed;
      const totalDuplicates = r1.duplicates + r2.duplicates;

      assert.equal(totalProcessed, 1, "Exactly one concurrent call should succeed");
      assert.equal(totalDuplicates, 1, "The duplicate call should be caught as duplicate");

      const session = await prisma.listeningSession.findUnique({
        where: { sessionId: sessionIdA },
      });
      // 15 (du test 1) + 15 (du test 2) = 30
      assert.equal(session?.listenedSeconds, 30, "Session listenedSeconds should have incremented exactly once by 15s");
    });

    // TEST 3: Tentative d'utiliser la session d'un autre compte (rejet de sécurité)
    await t.test("security: rejects event sent by User B for User A's session", async () => {
      const rogueEventId = `evt_rogue_${crypto.randomUUID()}`;
      const payload: PlaybackSessionEventPayload = {
        clientEventId: rogueEventId,
        sessionId: sessionIdA,
        episodeId,
        eventType: "progress",
        positionSeconds: 45,
        deltaSeconds: 15,
        playbackRate: 1.0,
        playSource: "home",
        occurredAtClient: new Date(now.getTime() + 3000).toISOString(),
      };

      const rogueRes = await InteractionCollectorService.recordListeningEvents([payload], userBId);
      assert.equal(rogueRes.rejected, 1, "Event attempting to hijack another user's session must be rejected");
      assert.equal(rogueRes.processed, 0, "No processing should happen for mismatched user");

      // Vérifier que la session de User A n'a pas été modifiée
      const session = await prisma.listeningSession.findUnique({
        where: { sessionId: sessionIdA },
      });
      assert.equal(session?.userId, userAId, "Session must still belong strictly to User A");
      assert.equal(session?.listenedSeconds, 30, "Session listenedSeconds must remain unchanged at 30");
    });

    // TEST 4: Traitement explicite des événements désordonnés (l'ancien timestamp ne recule pas la position)
    await t.test("out-of-order: older client event does not rewind active session positionSeconds", async () => {
      const laterEventId = `evt_later_${crypto.randomUUID()}`;
      const earlierEventId = `evt_earlier_${crypto.randomUUID()}`;

      // 1. Envoyer un événement plus récent avec position 120s à T = 10s
      const laterPayload: PlaybackSessionEventPayload = {
        clientEventId: laterEventId,
        sessionId: sessionIdA,
        episodeId,
        eventType: "progress",
        positionSeconds: 120,
        deltaSeconds: 15,
        playbackRate: 1.0,
        playSource: "home",
        occurredAtClient: new Date(now.getTime() + 10000).toISOString(),
      };
      await InteractionCollectorService.recordListeningEvents([laterPayload], userAId);

      const sessionAfterLater = await prisma.listeningSession.findUnique({
        where: { sessionId: sessionIdA },
      });
      assert.equal(sessionAfterLater?.positionSeconds, 120, "Position should be 120s");

      // 2. Envoyer un événement retardé avec position 60s survenu plus tôt à T = 5s
      const earlierPayload: PlaybackSessionEventPayload = {
        clientEventId: earlierEventId,
        sessionId: sessionIdA,
        episodeId,
        eventType: "progress",
        positionSeconds: 60,
        deltaSeconds: 10,
        playbackRate: 1.0,
        playSource: "home",
        occurredAtClient: new Date(now.getTime() + 5000).toISOString(),
      };
      await InteractionCollectorService.recordListeningEvents([earlierPayload], userAId);

      const sessionAfterEarlier = await prisma.listeningSession.findUnique({
        where: { sessionId: sessionIdA },
      });
      assert.equal(
        sessionAfterEarlier?.positionSeconds,
        120,
        "PositionSeconds must not rewind to 60 because event was occurred earlier than current active timestamp"
      );
      assert.equal(
        sessionAfterEarlier?.listenedSeconds,
        55, // 30 + 15 + 10 = 55
        "listenedSeconds should still account for the real listened delta of the delayed event"
      );
    });
  } finally {
    // Nettoyage après test
    await prisma.listeningEvent.deleteMany({
      where: {
        OR: [{ userId: userAId }, { userId: userBId }],
      },
    });
    await prisma.listeningSession.deleteMany({
      where: {
        OR: [{ userId: userAId }, { userId: userBId }],
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: { in: [userAId, userBId] },
      },
    });
    await prisma.$disconnect();
  }
});
