import { prisma } from "../../config/prisma.js";

export interface PlaybackSessionEventPayload {
  clientEventId: string;
  sessionId: string;
  episodeId: string;
  eventType: "start" | "progress" | "pause" | "seek" | "complete";
  positionSeconds: number;
  deltaSeconds?: number;
  playbackRate?: number;
  playSource?: string;
  recommendationId?: string;
  sectionId?: string;
  occurredAtClient: string;
}

export interface ImpressionPayload {
  batchId: string;
  sectionId: string;
  sectionSlug: string;
  targetType: "EPISODE" | "PODCAST";
  targetId: string;
  position: number;
  reason?: string;
  visibleAt?: string;
}

export interface InteractionPayload {
  batchId: string;
  sectionId: string;
  sectionSlug: string;
  targetType: "EPISODE" | "PODCAST";
  targetId: string;
  action: "CLICK" | "PLAY_START" | "QUALIFIED_PLAY" | "FAVORITE" | "LIKE" | "FOLLOW";
  position?: number;
}

export class InteractionCollectorService {
  /**
   * Enregistre un lot d'événements de session de lecture avec déduplication atomique et stricte.
   * Aucune session n'est incrémentée en cas d'événement déjà traité ou d'erreur concurrente.
   */
  static async recordListeningEvents(
    events: PlaybackSessionEventPayload[],
    userId?: string,
    anonymousId?: string
  ): Promise<{ processed: number; duplicates: number; rejected: number }> {
    let processed = 0;
    let duplicates = 0;
    let rejected = 0;

    for (const evt of events) {
      if (!evt.clientEventId || !evt.episodeId || !evt.sessionId) {
        rejected++;
        continue;
      }

      // Bornes et validation stricte (ne pas faire confiance aveuglément aux chiffres client)
      const validPosition = Math.max(0, Math.floor(evt.positionSeconds || 0));
      // Plafond de deltaSeconds : max 60s par tick de progression pour éviter les corruptions
      const validDelta = Math.max(0, Math.min(60, Math.floor(evt.deltaSeconds || 0)));
      const validRate = Math.max(0.25, Math.min(3.0, evt.playbackRate || 1.0));
      const clientDate = evt.occurredAtClient ? new Date(evt.occurredAtClient) : new Date();

      try {
        await prisma.$transaction(async (tx) => {
          // 1. Vérification d'idempotence immédiate : l'événement a-t-il déjà été enregistré ?
          const existingEvent = await tx.listeningEvent.findUnique({
            where: { clientEventId: evt.clientEventId },
          });

          if (existingEvent) {
            // Déjà enregistré (retry réseau) : ne pas toucher à la session !
            duplicates++;
            return;
          }

          // 2. Vérification de la session d'écoute et protection anti-détournement
          const existingSession = await tx.listeningSession.findUnique({
            where: { sessionId: evt.sessionId },
          });

          if (existingSession) {
            // Sécurité A : Impossible d'associer une session existante à un autre épisode
            if (existingSession.episodeId !== evt.episodeId) {
              console.warn(
                `[InteractionCollector] Rejet: Session ${evt.sessionId} appartient à l'épisode ${existingSession.episodeId}, pas ${evt.episodeId}`
              );
              rejected++;
              return;
            }

            // Sécurité B : Vérification d'appartenance d'identité
            if (existingSession.userId && userId && existingSession.userId !== userId) {
              console.warn(
                `[InteractionCollector] Rejet: Session ${evt.sessionId} appartient à ${existingSession.userId}, tentative par ${userId}`
              );
              rejected++;
              return;
            }

            if (existingSession.userId && !userId) {
              console.warn(
                `[InteractionCollector] Rejet: Session ${evt.sessionId} authentifiée tentée par un anonyme`
              );
              rejected++;
              return;
            }

            if (
              !existingSession.userId &&
              existingSession.anonymousId &&
              anonymousId &&
              existingSession.anonymousId !== anonymousId
            ) {
              console.warn(
                `[InteractionCollector] Rejet: Session anonyme ${evt.sessionId} mismatch (${existingSession.anonymousId} vs ${anonymousId})`
              );
              rejected++;
              return;
            }
          }

          // 3. Création atomique de l'événement unique
          const createdEvent = await tx.listeningEvent.create({
            data: {
              clientEventId: evt.clientEventId,
              listeningSessionId: existingSession?.id, // sera lié ci-dessous si nouvelle session
              userId,
              anonymousId,
              episodeId: evt.episodeId,
              eventType: evt.eventType,
              positionSeconds: validPosition,
              deltaSeconds: validDelta,
              playbackRate: validRate,
              playSource: evt.playSource,
              recommendationId: evt.recommendationId,
              sectionId: evt.sectionId,
              occurredAtClient: clientDate,
              receivedAtServer: new Date(),
            },
          });

          // 4. Mise à jour ou création de la session d'écoute
          if (existingSession) {
            // Traitement explicite des événements désordonnés : ne mettre à jour positionSeconds
            // que si l'horodatage client est plus récent ou égal au dernier horodatage enregistré
            const isNewer = clientDate >= existingSession.lastActiveAt;
            const updatedPosition = isNewer ? validPosition : existingSession.positionSeconds;
            const newLastActiveAt = isNewer ? clientDate : existingSession.lastActiveAt;

            await tx.listeningSession.update({
              where: { id: existingSession.id },
              data: {
                positionSeconds: updatedPosition,
                listenedSeconds: { increment: validDelta },
                completed: evt.eventType === "complete" ? true : existingSession.completed,
                lastActiveAt: newLastActiveAt,
                // Lier l'événement créé à la session
                events: { connect: { id: createdEvent.id } },
              },
            });
          } else {
            await tx.listeningSession.create({
              data: {
                sessionId: evt.sessionId,
                userId,
                anonymousId,
                episodeId: evt.episodeId,
                playSource: evt.playSource || "home",
                recommendationId: evt.recommendationId,
                sectionId: evt.sectionId,
                positionSeconds: validPosition,
                listenedSeconds: validDelta,
                completed: evt.eventType === "complete",
                startedAt: clientDate,
                lastActiveAt: clientDate,
                events: { connect: { id: createdEvent.id } },
              },
            });
          }

          processed++;
        });
      } catch (err: any) {
        if (err.code === "P2002") {
          // Conflit d'unicité concurrent sur clientEventId
          duplicates++;
        } else {
          console.warn("[InteractionCollector] Erreur transactionnelle écoute:", err.message);
          rejected++;
        }
      }
    }

    return { processed, duplicates, rejected };
  }

  /**
   * Enregistre un lot d'expositions (impressions réelles de cartes visibles à l'écran >= 50% pendant 1s)
   */
  static async recordImpressions(
    impressions: ImpressionPayload[],
    userId?: string,
    anonymousId?: string
  ): Promise<{ recorded: number; rejected: number }> {
    let recorded = 0;
    let rejected = 0;

    for (const imp of impressions) {
      if (!imp.batchId || !imp.sectionId || !imp.targetId) {
        rejected++;
        continue;
      }

      // Vérifier l'existence du lot et la cohérence de l'identité
      const batch = await prisma.recommendationBatch.findUnique({
        where: { batchId: imp.batchId },
      });

      if (!batch) {
        // Le lot n'existe pas : rejeter pour éviter les faux lots
        rejected++;
        continue;
      }

      if (batch.userId && userId && batch.userId !== userId) {
        rejected++;
        continue;
      }

      const episodeId = imp.targetType === "EPISODE" ? imp.targetId : null;
      const podcastId = imp.targetType === "PODCAST" ? imp.targetId : null;
      const visibleAt = imp.visibleAt ? new Date(imp.visibleAt) : new Date();

      try {
        await prisma.recommendationImpression.upsert({
          where: {
            batchId_sectionId_targetType_episodeId_podcastId_position: {
              batchId: imp.batchId,
              sectionId: imp.sectionId,
              targetType: imp.targetType,
              episodeId: (episodeId ?? null) as any,
              podcastId: (podcastId ?? null) as any,
              position: imp.position,
            },
          },
          update: {},
          create: {
            batchId: imp.batchId,
            sectionId: imp.sectionId,
            sectionSlug: imp.sectionSlug || "unknown",
            targetType: imp.targetType,
            episodeId,
            podcastId,
            position: imp.position,
            reason: imp.reason,
            userId,
            anonymousId,
            visibleAt,
            receivedAt: new Date(),
          },
        });
        recorded++;
      } catch (_) {
        // Déduplication silencieuse des impressions
      }
    }

    return { recorded, rejected };
  }

  /**
   * Enregistre une interaction attribuée à une recommandation (clic, lecture, like, save)
   */
  static async recordInteraction(
    interaction: InteractionPayload,
    userId?: string,
    anonymousId?: string
  ): Promise<boolean> {
    if (!interaction.batchId || !interaction.sectionId || !interaction.targetId) {
      return false;
    }

    // Vérifier l'existence du lot
    const batch = await prisma.recommendationBatch.findUnique({
      where: { batchId: interaction.batchId },
    });
    if (!batch) return false;

    if (batch.userId && userId && batch.userId !== userId) return false;

    const episodeId = interaction.targetType === "EPISODE" ? interaction.targetId : null;
    const podcastId = interaction.targetType === "PODCAST" ? interaction.targetId : null;

    try {
      await prisma.recommendationInteraction.create({
        data: {
          batchId: interaction.batchId,
          sectionId: interaction.sectionId,
          sectionSlug: interaction.sectionSlug,
          targetType: interaction.targetType,
          episodeId,
          podcastId,
          action: interaction.action,
          position: interaction.position,
          userId,
          anonymousId,
          occurredAt: new Date(),
          receivedAt: new Date(),
        },
      });
      return true;
    } catch (e) {
      return false;
    }
  }
}
