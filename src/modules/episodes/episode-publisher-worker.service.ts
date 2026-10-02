import { prisma } from "../../config/prisma.js";
import { NotificationService } from "../../services/notification.service.js";

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
        // Mise à jour conditionnelle : aucun effet si l'épisode n'est plus programmé.
        const done = await prisma.episode.updateMany({
          where: { id: episodeId, status: "SCHEDULED" },
          data: { status: "PUBLISHED", publishedAt: new Date() },
        });
        if (done.count > 0) {
          const ep = await prisma.episode.findUnique({ where: { id: episodeId }, select: { title: true, podcastId: true } });
          if (ep) {
            await NotificationService.notifyTeam(ep.podcastId, {
              type: "EPISODE_PUBLISHED",
              title: `Épisode publié : ${ep.title}`,
              body: "Sa mise en ligne programmée vient d'avoir lieu.",
              link: `/studio/episodes/${episodeId}/edit`,
            });
            await NotificationService.notifyFollowersOfEpisode(episodeId);
          }
        }
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
