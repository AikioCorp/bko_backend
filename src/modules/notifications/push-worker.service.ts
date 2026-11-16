import { prisma } from "../../config/prisma.js";
import { PushNotificationService, PushNotificationPayload } from "../../services/push-notification.service.js";

interface PushJobPayload {
  userIds: string[];
  title: string;
  body: string;
  route?: string;
  type?: string;
  actionLabel?: string;
}

/**
 * Worker résilient traitant la file persistante "push_notifications".
 * Assure la reprise après redémarrage, les nouvelles tentatives avec backoff et la déduplication.
 */
export class PushWorkerService {
  static async processNextJob(): Promise<boolean> {
    const job = await prisma.$transaction(async (tx) => {
      const pending = await tx.jobQueueItem.findFirst({
        where: { status: "PENDING", queueName: "push_notifications", runAt: { lte: new Date() } },
        orderBy: { runAt: "asc" },
      });
      if (!pending) return null;
      const claimed = await tx.jobQueueItem.updateMany({
        where: { id: pending.id, status: "PENDING" },
        data: { status: "PROCESSING", lockedAt: new Date(), lockedBy: "worker-push-1", attempts: { increment: 1 } },
      });
      if (claimed.count === 0) return null;
      return tx.jobQueueItem.findUnique({ where: { id: pending.id } });
    });

    if (!job) return false;

    try {
      const payload = job.payload as unknown as PushJobPayload;
      if (Array.isArray(payload.userIds) && payload.userIds.length > 0) {
        await PushNotificationService.sendToUsers(payload.userIds, {
          title: payload.title,
          body: payload.body,
          route: payload.route,
          data: {
            type: payload.type || "GENERIC",
            actionLabel: payload.actionLabel || "Ouvrir",
          },
        });
      }

      await prisma.jobQueueItem.update({
        where: { id: job.id },
        data: { status: "COMPLETED", payload: {} },
      });
    } catch (error: any) {
      const final = job.attempts >= job.maxAttempts;
      await prisma.jobQueueItem.update({
        where: { id: job.id },
        data: {
          status: final ? "FAILED" : "PENDING",
          lastError: error.message || "Erreur push",
          runAt: new Date(Date.now() + job.attempts * job.attempts * 60_000),
        },
      });
    }

    return true;
  }
}
