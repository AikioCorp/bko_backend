import { Prisma, ReportStatus, ReportTargetType, ReportReason } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AuditService } from "../../services/audit.service.js";
import { FeatureFlags } from "../../config/feature-flags.js";
import { NotificationService } from "../../services/notification.service.js";

export class AdminConsoleService {
  // ───────────────────────── VALIDATION ÉDITORIALE ─────────────────────────

  static async listReviewQueue() {
    const [episodes, podcasts] = await Promise.all([
      prisma.episode.findMany({
        where: { status: "PENDING_REVIEW" },
        orderBy: { updatedAt: "asc" },
        take: 100,
        select: {
          id: true,
          title: true,
          cover: true,
          durationSeconds: true,
          languageCode: true,
          updatedAt: true,
          podcast: { select: { id: true, name: true, slug: true, cover: true } },
          mediaSources: { select: { type: true, provider: true, playbackMode: true }, take: 1 },
        },
      }),
      prisma.podcast.findMany({
        where: { status: "PENDING_REVIEW" },
        orderBy: { updatedAt: "asc" },
        take: 100,
        select: {
          id: true,
          name: true,
          slug: true,
          cover: true,
          primaryLanguageCode: true,
          updatedAt: true,
          members: { where: { role: "OWNER" }, take: 1, select: { user: { select: { fullName: true, email: true } } } },
        },
      }),
    ]);
    return { episodes, podcasts };
  }

  static async reviewEpisode(actorId: string, id: string, decision: "APPROVE" | "REJECT", note?: string, ip?: string) {
    const episode = await prisma.episode.findUnique({ where: { id } });
    if (!episode) throw new Error("NOT_FOUND");
    if (episode.status !== "PENDING_REVIEW") throw new Error("NOT_PENDING_REVIEW");
    if (decision === "REJECT" && !note?.trim()) throw new Error("REVIEW_NOTE_REQUIRED");

    const updated = await prisma.episode.update({
      where: { id },
      data:
        decision === "APPROVE"
          ? {
              // Date visée dans le futur : on programme au lieu de publier immédiatement.
              status: episode.publishedAt && episode.publishedAt > new Date() ? "SCHEDULED" : "PUBLISHED",
              publishedAt: episode.publishedAt && episode.publishedAt > new Date() ? episode.publishedAt : new Date(),
              reviewNote: null,
              reviewedAt: new Date(),
              reviewedById: actorId,
            }
          : { status: "DRAFT", reviewNote: note!.trim(), reviewedAt: new Date(), reviewedById: actorId },
    });
    if (decision === "APPROVE" && updated.status === "SCHEDULED") {
      await prisma.jobQueueItem.create({
        data: { queueName: "episodes-publisher", jobType: "PUBLISH_EPISODE", payload: { episodeId: id }, runAt: updated.publishedAt! },
      });
    }
    if (decision === "APPROVE") {
      await NotificationService.notifyTeam(
        episode.podcastId,
        {
          type: "EPISODE_APPROVED",
          title: `Épisode approuvé : ${episode.title}`,
          body: updated.status === "SCHEDULED" ? "Il sera mis en ligne à la date prévue." : "Il est maintenant en ligne.",
          link: `/studio/episodes/${id}/edit`,
        },
        { email: true }
      );
      if (updated.status === "PUBLISHED") await NotificationService.notifyFollowersOfEpisode(id);
    } else {
      await NotificationService.notifyTeam(
        episode.podcastId,
        { type: "EPISODE_REJECTED", title: `Épisode à corriger : ${episode.title}`, body: `Motif : ${note!.trim()}`, link: `/studio/episodes/${id}/edit` },
        { email: true }
      );
    }
    await AuditService.logAction({
      actorId,
      action: decision === "APPROVE" ? "EPISODE_APPROVED" : "EPISODE_REJECTED",
      entityType: "Episode",
      entityId: id,
      previousState: { status: episode.status },
      newState: { status: updated.status, note },
      ipAddress: ip,
    });
    return updated;
  }

  static async reviewPodcast(actorId: string, id: string, decision: "APPROVE" | "REJECT", note?: string, ip?: string) {
    const podcast = await prisma.podcast.findUnique({ where: { id } });
    if (!podcast) throw new Error("NOT_FOUND");
    if (podcast.status !== "PENDING_REVIEW") throw new Error("NOT_PENDING_REVIEW");
    if (decision === "REJECT" && !note?.trim()) throw new Error("REVIEW_NOTE_REQUIRED");

    const updated = await prisma.podcast.update({
      where: { id },
      data:
        decision === "APPROVE"
          ? { status: "PUBLISHED", reviewNote: null, reviewedAt: new Date(), reviewedById: actorId }
          : { status: "DRAFT", reviewNote: note!.trim(), reviewedAt: new Date(), reviewedById: actorId },
    });
    await NotificationService.notifyTeam(
      id,
      decision === "APPROVE"
        ? { type: "PODCAST_APPROVED", title: `Podcast approuvé : ${podcast.name}`, body: "Il est maintenant visible dans le catalogue.", link: `/studio/podcasts/${id}` }
        : { type: "PODCAST_REJECTED", title: `Podcast à corriger : ${podcast.name}`, body: `Motif : ${note!.trim()}`, link: `/studio/podcasts/${id}` },
      { email: true }
    );
    await AuditService.logAction({
      actorId,
      action: decision === "APPROVE" ? "PODCAST_APPROVED" : "PODCAST_REJECTED",
      entityType: "Podcast",
      entityId: id,
      previousState: { status: podcast.status },
      newState: { status: updated.status, note },
      ipAddress: ip,
    });
    return updated;
  }

  // ───────────────────────── SIGNALEMENTS ─────────────────────────

  static async createReport(
    reporterId: string,
    data: { targetType: ReportTargetType; targetId: string; reason: ReportReason; description?: string }
  ) {
    // Anti-spam : un même utilisateur ne peut avoir qu'un signalement ouvert par cible.
    const existing = await prisma.report.findFirst({
      where: {
        reporterId,
        targetType: data.targetType,
        targetId: data.targetId,
        status: { in: ["OPEN", "IN_REVIEW"] },
      },
    });
    if (existing) throw new Error("REPORT_ALREADY_OPEN");
    return prisma.report.create({ data: { ...data, reporterId } });
  }

  private static async resolveTargets(reports: { targetType: ReportTargetType; targetId: string }[]) {
    const ids = (t: ReportTargetType) => reports.filter((r) => r.targetType === t).map((r) => r.targetId);
    const [episodes, podcasts] = await Promise.all([
      prisma.episode.findMany({
        where: { id: { in: ids("EPISODE") } },
        select: { id: true, title: true, status: true, podcast: { select: { name: true } } },
      }),
      prisma.podcast.findMany({ where: { id: { in: ids("PODCAST") } }, select: { id: true, name: true, status: true } }),
    ]);
    const map = new Map<string, { label: string; subLabel?: string; status?: string }>();
    episodes.forEach((e) => map.set(`EPISODE:${e.id}`, { label: e.title, subLabel: e.podcast.name, status: e.status }));
    podcasts.forEach((p) => map.set(`PODCAST:${p.id}`, { label: p.name, status: p.status }));
    return map;
  }

  static async listReports(params: { status?: ReportStatus; reason?: ReportReason; page: number; limit: number }) {
    const where: Prisma.ReportWhereInput = {
      ...(params.status ? { status: params.status } : { status: { in: ["OPEN", "IN_REVIEW"] } }),
      ...(params.reason ? { reason: params.reason } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.report.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: { reporter: { select: { id: true, fullName: true } } },
      }),
      prisma.report.count({ where }),
    ]);
    const targets = await this.resolveTargets(items);
    return {
      items: items.map((r) => ({ ...r, target: targets.get(`${r.targetType}:${r.targetId}`) ?? null })),
      total,
      page: params.page,
      limit: params.limit,
    };
  }

  /**
   * Traite un signalement. `action` permet de sanctionner la cible en même temps :
   *  - SUSPEND_TARGET : podcast → SUSPENDED, épisode → ARCHIVED (retrait du catalogue public).
   */
  static async handleReport(
    actorId: string,
    id: string,
    data: { status: ReportStatus; note?: string; action?: "SUSPEND_TARGET" },
    ip?: string
  ) {
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) throw new Error("NOT_FOUND");

    let targetChange: Record<string, unknown> | undefined;
    if (data.action === "SUSPEND_TARGET") {
      if (report.targetType === "PODCAST") {
        await prisma.podcast.update({ where: { id: report.targetId }, data: { status: "SUSPENDED" } });
        targetChange = { podcastStatus: "SUSPENDED" };
      } else if (report.targetType === "EPISODE") {
        await prisma.episode.update({ where: { id: report.targetId }, data: { status: "ARCHIVED" } });
        targetChange = { episodeStatus: "ARCHIVED" };
      } else {
        throw new Error("ACTION_NOT_SUPPORTED_FOR_TARGET");
      }
    }

    const closing = ["RESOLVED", "REJECTED", "DISMISSED"].includes(data.status);
    const updated = await prisma.report.update({
      where: { id },
      data: {
        status: data.status,
        resolutionNote: data.note?.trim() || undefined,
        ...(closing ? { resolvedById: actorId, resolvedAt: new Date() } : {}),
      },
    });
    if (data.action === "SUSPEND_TARGET") {
      const podcastId =
        report.targetType === "PODCAST"
          ? report.targetId
          : (await prisma.episode.findUnique({ where: { id: report.targetId }, select: { podcastId: true } }))?.podcastId;
      if (podcastId) {
        await NotificationService.notifyTeam(
          podcastId,
          {
            type: "CONTENT_REMOVED",
            title: report.targetType === "PODCAST" ? "Votre podcast a été suspendu" : "Un de vos épisodes a été retiré",
            body: data.note?.trim() ? `Motif : ${data.note.trim()}` : "Suite à un signalement examiné par la modération. Contactez le support pour en savoir plus.",
            link: `/studio/podcasts/${podcastId}`,
          },
          { email: true }
        );
      }
    }
    if (closing && report.reporterId) {
      await NotificationService.notify([report.reporterId], {
        type: "REPORT_HANDLED",
        title: "Votre signalement a été examiné",
        body: "Merci de contribuer à la qualité de la plateforme.",
      });
    }
    await AuditService.logAction({
      actorId,
      action: "REPORT_HANDLED",
      entityType: "Report",
      entityId: id,
      previousState: { status: report.status },
      newState: { status: data.status, note: data.note, ...targetChange },
      ipAddress: ip,
    });
    return updated;
  }

  // ───────────────────────── UTILISATEURS ─────────────────────────

  static async listUsers(params: { search?: string; role?: string; page: number; limit: number }) {
    const where: Prisma.UserWhereInput = {
      ...(params.search
        ? {
            OR: [
              { email: { contains: params.search, mode: "insensitive" } },
              { fullName: { contains: params.search, mode: "insensitive" } },
              { phoneNumber: { contains: params.search } },
            ],
          }
        : {}),
      ...(params.role ? { userRoles: { some: { role: { name: params.role } } } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        select: {
          id: true,
          email: true,
          fullName: true,
          phoneNumber: true,
          avatar: true,
          isVerified: true,
          isSuspended: true,
          suspendedReason: true,
          createdAt: true,
          userRoles: { select: { role: { select: { name: true } } } },
          creatorProfile: { select: { id: true, slug: true, isVerified: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);
    return {
      items: items.map(({ userRoles, ...u }) => ({ ...u, roles: userRoles.map((ur) => ur.role.name) })),
      total,
      page: params.page,
      limit: params.limit,
    };
  }

  /** Marque un créateur comme "de confiance" : ses contenus ne passent plus par la validation préalable. */
  static async setCreatorVerification(actorId: string, userId: string, verified: boolean, ip?: string) {
    const profile = await prisma.creatorProfile.findUnique({ where: { userId } });
    if (!profile) throw new Error("CREATOR_PROFILE_NOT_FOUND");
    await prisma.creatorProfile.update({ where: { userId }, data: { isVerified: verified } });
    await AuditService.logAction({
      actorId,
      action: verified ? "CREATOR_VERIFIED" : "CREATOR_UNVERIFIED",
      entityType: "CreatorProfile",
      entityId: profile.id,
      newState: { verified },
      ipAddress: ip,
    });
    return { userId, isVerified: verified };
  }

  // ───────────────────────── STOCKAGE & JOBS ─────────────────────────

  static async getStorageOverview() {
    const [usage, byStatus, topOwners, failedAssets, jobsByStatus, failedJobs] = await Promise.all([
      prisma.mediaAsset.aggregate({ where: { status: { not: "DELETED" } }, _sum: { sizeBytes: true }, _count: true }),
      prisma.mediaAsset.groupBy({ by: ["status"], _count: { id: true }, _sum: { sizeBytes: true } }),
      prisma.mediaAsset.groupBy({
        by: ["ownerId"],
        where: { status: { not: "DELETED" } },
        _sum: { sizeBytes: true },
        _count: { id: true },
        orderBy: { _sum: { sizeBytes: "desc" } },
        take: 10,
      }),
      prisma.mediaAsset.findMany({
        where: { status: "FAILED" },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, key: true, mimeType: true, sizeBytes: true, createdAt: true, owner: { select: { fullName: true } } },
      }),
      prisma.jobQueueItem.groupBy({ by: ["status"], _count: { id: true } }),
      prisma.jobQueueItem.findMany({
        where: { status: "FAILED" },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: { id: true, queueName: true, jobType: true, attempts: true, lastError: true, updatedAt: true },
      }),
    ]);
    const owners = await prisma.user.findMany({
      where: { id: { in: topOwners.map((o) => o.ownerId) } },
      select: { id: true, fullName: true, email: true },
    });
    const ownerMap = new Map(owners.map((o) => [o.id, o]));

    // BigInt → Number (tailles en octets, très en deçà de 2^53).
    const n = (v: bigint | null | undefined) => Number(v ?? 0);
    return {
      totalBytes: n(usage._sum.sizeBytes),
      totalAssets: usage._count,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count.id, bytes: n(s._sum.sizeBytes) })),
      topOwners: topOwners.map((o) => ({
        owner: ownerMap.get(o.ownerId) ?? null,
        bytes: n(o._sum.sizeBytes),
        assets: o._count.id,
      })),
      failedAssets: failedAssets.map((a) => ({ ...a, sizeBytes: n(a.sizeBytes) })),
      jobsByStatus: jobsByStatus.map((j) => ({ status: j.status, count: j._count.id })),
      failedJobs,
    };
  }

  static async retryJob(actorId: string, jobId: string, ip?: string) {
    const job = await prisma.jobQueueItem.findUnique({ where: { id: jobId } });
    if (!job) throw new Error("JOB_NOT_FOUND");
    if (job.status !== "FAILED") throw new Error("JOB_NOT_FAILED");
    const updated = await prisma.jobQueueItem.update({
      where: { id: jobId },
      data: { status: "PENDING", attempts: 0, runAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
    });
    await AuditService.logAction({ actorId, action: "JOB_RETRIED", entityType: "JobQueueItem", entityId: jobId, ipAddress: ip });
    return updated;
  }

  // ───────────────────────── SUPERVISION ─────────────────────────

  static async getOverview() {
    const since7 = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);
    const [
      episodesPublished,
      episodesThisWeek,
      pendingEpisodes,
      pendingPodcasts,
      pendingCreatorAccess,
      openReports,
      reportsByReason,
      activeListeners24h,
      plays7d,
      storage,
      failedJobs,
      recentAudit,
    ] = await Promise.all([
      prisma.episode.count({ where: { status: "PUBLISHED" } }),
      prisma.episode.count({ where: { status: "PUBLISHED", publishedAt: { gte: since7 } } }),
      prisma.episode.count({ where: { status: "PENDING_REVIEW" } }),
      prisma.podcast.count({ where: { status: "PENDING_REVIEW" } }),
      prisma.creatorMarketAccess.count({ where: { status: "PENDING" } }),
      prisma.report.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
      prisma.report.groupBy({ by: ["reason"], where: { status: { in: ["OPEN", "IN_REVIEW"] } }, _count: { id: true } }),
      prisma.playbackHistory.groupBy({ by: ["userId"], where: { lastPlayedAt: { gte: since24h } } }).then((r) => r.length),
      prisma.episodeDailyStats.aggregate({ where: { date: { gte: since7 } }, _sum: { plays: true } }),
      prisma.mediaAsset.aggregate({ where: { status: { not: "DELETED" } }, _sum: { sizeBytes: true } }),
      prisma.jobQueueItem.count({ where: { status: "FAILED" } }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { actor: { select: { fullName: true } } },
      }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      kpis: {
        activeListeners24h,
        episodesPublished,
        episodesThisWeek,
        plays7d: plays7d._sum.plays ?? 0,
        pendingCreatorAccess,
        openReports,
        storageBytes: Number(storage._sum.sizeBytes ?? 0),
        failedJobs,
      },
      pendingReview: { episodes: pendingEpisodes, podcasts: pendingPodcasts },
      reportsByReason: reportsByReason.map((r) => ({ reason: r.reason, count: r._count.id })),
      recentAudit,
    };
  }

  /** Configuration en lecture seule : jamais de secrets, uniquement l'état des interrupteurs. */
  static getSettings() {
    return {
      featureFlags: {
        uploads: FeatureFlags.enableUploads,
        rss: FeatureFlags.enableRss,
        transcription: FeatureFlags.enableTranscription,
        requireVerifiedLogin: FeatureFlags.requireVerifiedLogin,
        requireContentReview: FeatureFlags.requireContentReview,
      },
      storage: {
        provider: process.env.STORAGE_PROVIDER ?? "LOCAL",
        configured: Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID),
      },
      transcription: { provider: process.env.TRANSCRIPTION_PROVIDER ?? "none", configured: Boolean(process.env.OPENAI_API_KEY) },
      environment: process.env.NODE_ENV ?? "development",
    };
  }
}
