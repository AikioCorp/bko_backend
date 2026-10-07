import { prisma } from "../../config/prisma.js";
import { NotificationService } from "../../services/notification.service.js";
import { EpisodePublishValidationService } from "../../services/episode-publish-validation.service.js";

/**
 * Publie les épisodes programmés dont l'heure est venue (file "episodes-publisher").
 * Le job est idempotent : si l'épisode n'est plus SCHEDULED (programmation annulée,
 * contenu retiré ou déjà publié), il est simplement clos sans effet.
 */
export class EpisodePublisherWorkerService {
  static async processNextJob(): Promise<boolean> {
    const job = await prisma.$transaction(async (tx) => {
      const pending = await tx.jobQueueItem.findFirst({
        where: { status: "PENDING", queueName: "episodes-publisher", runAt: { lte: new Date() } },
        orderBy: { runAt: "asc" },
      });
      if (!pending) return null;
      return tx.jobQueueItem.update({
        where: { id: pending.id },
        data: { status: "PROCESSING", lockedAt: new Date(), lockedBy: "worker-1", attempts: { increment: 1 } },
      });
    });
    if (!job) return false;

    try {
      if (job.jobType === "PUBLISH_EPISODE") {
        const { episodeId } = job.payload as { episodeId: string };

        // 1. Vérifier si l'épisode est toujours SCHEDULED
        const episode = await prisma.episode.findUnique({
          where: { id: episodeId },
          select: { id: true, status: true, title: true, podcastId: true },
        });

        if (!episode || episode.status !== "SCHEDULED") {
          // L'épisode a été dépublié, supprimé ou annulé entre-temps.
          await prisma.jobQueueItem.update({ where: { id: job.id }, data: { status: "COMPLETED" } });
          return true;
        }

        // 2. Vérification de sécurité à l'échéance : le podcast est-il toujours actif et le média prêt ?
        const validation = await EpisodePublishValidationService.validate(episodeId);
        if (!validation.ready) {
          const reasons = validation.issues.filter((i) => !i.ok).map((i) => i.message || i.label).join(", ");
          throw new Error(`Conditions de publication non remplies à l'échéance : ${reasons}`);
        }

        // 3. Mise à jour vers PUBLISHED
        await prisma.episode.update({
          where: { id: episodeId },
          data: { status: "PUBLISHED", publishedAt: new Date() },
        });

        await NotificationService.notifyTeam(episode.podcastId, {
          type: "EPISODE_PUBLISHED",
          title: `Épisode publié : ${episode.title}`,
          body: "Sa mise en ligne programmée vient d'avoir lieu.",
          link: `/studio/episodes/${episodeId}/edit`,
        });
        await NotificationService.notifyFollowersOfEpisode(episodeId);
      }
      await prisma.jobQueueItem.update({ where: { id: job.id }, data: { status: "COMPLETED" } });
    } catch (error: any) {
      await prisma.jobQueueItem.update({
        where: { id: job.id },
        data: {
          status: job.attempts >= job.maxAttempts ? "FAILED" : "PENDING",
          lastError: error.message || "Erreur de publication",
        },
      });
    }
    return true;
  }
}
