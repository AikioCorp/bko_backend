import { prisma } from "../../config/prisma.js";
import { MailService, Mail } from "../../services/mail/mail.service.js";
import { NotificationService } from "../../services/notification.service.js";

/** Envoie les emails en file ("emails") avec nouvelles tentatives, et purge périodiquement les anciennes notifications. */
export class EmailWorkerService {
  private static lastPurge = 0;

  static async processNextJob(): Promise<boolean> {
    if (Date.now() - this.lastPurge > 6 * 3600 * 1000) {
      this.lastPurge = Date.now();
      NotificationService.purgeOld().catch(() => {});
    }

    const job = await prisma.$transaction(async (tx) => {
      const pending = await tx.jobQueueItem.findFirst({
        where: { status: "PENDING", queueName: "emails", runAt: { lte: new Date() } },
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
      await MailService.deliver(job.payload as unknown as Mail);
      // Le contenu de l'email n'a plus lieu d'être conservé une fois envoyé.
      await prisma.jobQueueItem.update({ where: { id: job.id }, data: { status: "COMPLETED", payload: {} } });
    } catch (error: any) {
      const final = job.attempts >= job.maxAttempts;
      await prisma.jobQueueItem.update({
        where: { id: job.id },
        data: {
          status: final ? "FAILED" : "PENDING",
          lastError: error.message,
          // Attente croissante entre les tentatives : 1 min, 4 min, 9 min…
          runAt: new Date(Date.now() + job.attempts * job.attempts * 60_000),
        },
      });
    }
    return true;
  }
}
