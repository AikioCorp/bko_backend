import { Prisma, ReportStatus, ReportTargetType, ReportReason, SubscriptionStatus, SubscriptionScope, PodcastMemberRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AuditService } from "../../services/audit.service.js";
import { FeatureFlags } from "../../config/feature-flags.js";
import { NotificationService } from "../../services/notification.service.js";
import { PodcastTeamService } from "../creator/podcast-team.service.js";

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
      items: items.map(({ userRoles, creatorProfile, ...u }) => ({
        ...u,
        isEmailVerified: u.isVerified,
        isCreatorVerified: Boolean(creatorProfile?.isVerified),
        hasCreatorProfile: Boolean(creatorProfile),
        creatorProfile,
        roles: userRoles.map((ur) => ur.role.name),
      })),
      total,
      page: params.page,
      limit: params.limit,
    };
  }

  /** Marque un créateur comme certifié : badge bleu et pas de validation préalable. */
  static async setCreatorVerification(actorId: string, userId: string, verified: boolean, ip?: string) {
    let profile = await prisma.creatorProfile.findUnique({ where: { userId } });
    if (!profile) {
      if (verified) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error("NOT_FOUND");
        const slugBase = (user.fullName || "creator")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim()
          .replace(/[\s-]+/g, "-")
          .replace(/[^\w-]+/g, "");
        let slug = slugBase || "creator";
        let count = 1;
        while (await prisma.creatorProfile.findUnique({ where: { slug } })) {
          count++;
          slug = `${slugBase}-${count}`;
        }
        profile = await prisma.creatorProfile.create({
          data: {
            userId,
            displayName: user.fullName || "Créateur",
            slug,
            isVerified: true,
          },
        });
        const creatorRole = await prisma.role.findUnique({ where: { name: "CREATOR" } });
        if (creatorRole) {
          await prisma.userRole.upsert({
            where: { userId_roleId: { userId, roleId: creatorRole.id } },
            create: { userId, roleId: creatorRole.id },
            update: {},
          });
        }
      } else {
        return { userId, isVerified: false };
      }
    } else {
      await prisma.creatorProfile.update({ where: { userId }, data: { isVerified: verified } });
    }
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

  // ───────────────────────── GESTION DES CRÉATEURS ─────────────────────────

  static async listCreators(params: {
    page?: number;
    limit?: number;
    search?: string;
    verified?: boolean;
    countryId?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params.search) {
      where.OR = [
        { displayName: { contains: params.search, mode: "insensitive" } },
        { slug: { contains: params.search, mode: "insensitive" } },
        { bio: { contains: params.search, mode: "insensitive" } },
        { user: { email: { contains: params.search, mode: "insensitive" } } },
        { user: { fullName: { contains: params.search, mode: "insensitive" } } },
      ];
    }
    if (typeof params.verified === "boolean") {
      where.isVerified = params.verified;
    }
    if (params.countryId) {
      where.countryId = params.countryId;
    }

    const [items, total, verifiedCount, totalFollowers] = await Promise.all([
      prisma.creatorProfile.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              fullName: true,
              isSuspended: true,
              suspendedReason: true,
              createdAt: true,
              userRoles: { select: { role: { select: { name: true } } } },
            },
          },
          country: { select: { id: true, name: true, code: true, flagEmoji: true } },
          _count: { select: { followers: true } },
          marketAccess: {
            select: {
              id: true,
              status: true,
              canCreatePodcast: true,
              canPublish: true,
              canMonetize: true,
              market: { select: { id: true, countryId: true, country: { select: { code: true, name: true, flagEmoji: true } } } },
            },
          },
        },
      }),
      prisma.creatorProfile.count({ where }),
      prisma.creatorProfile.count({ where: { isVerified: true } }),
      prisma.creatorFollow.count(),
    ]);

    const userIds = items.map((i) => i.userId);
    const podcastMembers = userIds.length
      ? await prisma.podcastMember.findMany({
          where: { userId: { in: userIds } },
          include: {
            podcast: {
              select: {
                id: true,
                name: true,
                slug: true,
                cover: true,
                status: true,
                _count: { select: { episodes: true } },
              },
            },
          },
        })
      : [];

    const podcastsByUser = new Map<string, any[]>();
    for (const pm of podcastMembers) {
      const list = podcastsByUser.get(pm.userId) || [];
      list.push(pm.podcast);
      podcastsByUser.set(pm.userId, list);
    }

    return {
      items: items.map((c) => ({
        id: c.id,
        userId: c.userId,
        displayName: c.displayName,
        slug: c.slug,
        bio: c.bio,
        avatar: c.avatar,
        banner: c.banner,
        website: c.website,
        socialLinks: c.socialLinks,
        isVerified: c.isVerified,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        country: c.country,
        user: {
          ...c.user,
          roles: c.user.userRoles.map((r) => r.role.name),
        },
        followersCount: c._count.followers,
        marketAccess: c.marketAccess,
        podcasts: podcastsByUser.get(c.userId) || [],
        podcastsCount: (podcastsByUser.get(c.userId) || []).length,
      })),
      total,
      page,
      limit,
      stats: {
        totalCreators: total,
        verifiedCount,
        totalFollowers,
      },
    };
  }

  static async createCreator(
    actorId: string,
    data: {
      userId: string;
      displayName: string;
      slug?: string;
      bio?: string;
      website?: string;
      countryId?: string;
      isVerified?: boolean;
    },
    ip?: string
  ) {
    const user = await prisma.user.findUnique({ where: { id: data.userId } });
    if (!user) throw new Error("NOT_FOUND");

    const existing = await prisma.creatorProfile.findUnique({ where: { userId: data.userId } });
    if (existing) throw new Error("CREATOR_ALREADY_EXISTS");

    const slugBase = (data.slug || data.displayName || user.fullName || "creator")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .replace(/[\s-]+/g, "-")
      .replace(/[^\w-]+/g, "");
    let slug = slugBase || "creator";
    let count = 1;
    while (await prisma.creatorProfile.findUnique({ where: { slug } })) {
      count++;
      slug = `${slugBase}-${count}`;
    }

    const profile = await prisma.creatorProfile.create({
      data: {
        userId: data.userId,
        displayName: data.displayName,
        slug,
        bio: data.bio,
        website: data.website,
        countryId: data.countryId,
        isVerified: Boolean(data.isVerified),
      },
      include: {
        country: true,
        user: { select: { id: true, email: true, fullName: true } },
      },
    });

    const creatorRole = await prisma.role.findUnique({ where: { name: "CREATOR" } });
    if (creatorRole) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: data.userId, roleId: creatorRole.id } },
        create: { userId: data.userId, roleId: creatorRole.id },
        update: {},
      });
    }

    await AuditService.logAction({
      actorId,
      action: "CREATOR_CREATED",
      entityType: "CreatorProfile",
      entityId: profile.id,
      newState: { displayName: profile.displayName, slug: profile.slug, isVerified: profile.isVerified },
      ipAddress: ip,
    });

    return profile;
  }

  static async updateCreator(
    actorId: string,
    profileId: string,
    data: {
      displayName?: string;
      slug?: string;
      bio?: string;
      website?: string;
      countryId?: string;
      isVerified?: boolean;
      avatar?: string;
      banner?: string;
      socialLinks?: any;
    },
    ip?: string
  ) {
    const profile = await prisma.creatorProfile.findUnique({ where: { id: profileId } });
    if (!profile) throw new Error("NOT_FOUND");

    if (data.slug && data.slug !== profile.slug) {
      const clash = await prisma.creatorProfile.findUnique({ where: { slug: data.slug } });
      if (clash) throw new Error("SLUG_ALREADY_EXISTS");
    }

    const updated = await prisma.creatorProfile.update({
      where: { id: profileId },
      data: {
        displayName: data.displayName ?? profile.displayName,
        slug: data.slug ?? profile.slug,
        bio: data.bio !== undefined ? data.bio : profile.bio,
        website: data.website !== undefined ? data.website : profile.website,
        countryId: data.countryId !== undefined ? data.countryId : profile.countryId,
        isVerified: data.isVerified !== undefined ? data.isVerified : profile.isVerified,
        avatar: data.avatar !== undefined ? data.avatar : profile.avatar,
        banner: data.banner !== undefined ? data.banner : profile.banner,
        socialLinks: data.socialLinks !== undefined ? data.socialLinks : profile.socialLinks,
      },
      include: {
        country: true,
        user: { select: { id: true, email: true, fullName: true } },
      },
    });

    await AuditService.logAction({
      actorId,
      action: "CREATOR_UPDATED",
      entityType: "CreatorProfile",
      entityId: profile.id,
      newState: data,
      ipAddress: ip,
    });

    return updated;
  }

  static async deleteCreatorProfile(actorId: string, profileId: string, ip?: string) {
    const profile = await prisma.creatorProfile.findUnique({ where: { id: profileId } });
    if (!profile) throw new Error("NOT_FOUND");

    await prisma.creatorProfile.delete({ where: { id: profileId } });

    await AuditService.logAction({
      actorId,
      action: "CREATOR_DELETED",
      entityType: "CreatorProfile",
      entityId: profileId,
      previousState: { displayName: profile.displayName, slug: profile.slug },
      ipAddress: ip,
    });

    return { success: true };
  }

  static async assignPodcastToCreator(
    actorId: string,
    profileId: string,
    podcastId: string,
    role: PodcastMemberRole = "OWNER",
    ip?: string
  ) {
    const profile = await prisma.creatorProfile.findUnique({ where: { id: profileId } });
    if (!profile) throw new Error("NOT_FOUND");

    return this.addPodcastMember(actorId, podcastId, { userId: profile.userId, role }, ip);
  }

  static async getPodcastMembers(podcastId: string) {
    const podcast = await prisma.podcast.findUnique({ where: { id: podcastId } });
    if (!podcast) throw new Error("NOT_FOUND");

    return prisma.podcastMember.findMany({
      where: { podcastId },
      include: {
        user: { select: { id: true, fullName: true, email: true, avatar: true, phoneNumber: true } },
      },
      orderBy: { id: "asc" },
    });
  }

  static async addPodcastMember(
    actorId: string,
    podcastId: string,
    input: { userId?: string; email?: string; role: PodcastMemberRole },
    ip?: string
  ) {
    return PodcastTeamService.directAddMember(actorId, podcastId, input, true, ip);
  }

  static async updatePodcastMemberRole(
    actorId: string,
    podcastId: string,
    targetUserId: string,
    role: PodcastMemberRole,
    ip?: string
  ) {
    const target = await prisma.podcastMember.findUnique({ where: { podcastId_userId: { podcastId, userId: targetUserId } } });
    if (!target) throw new Error("NOT_FOUND");

    if (target.role === "OWNER" && role !== "OWNER") {
      const owners = await prisma.podcastMember.count({ where: { podcastId, role: "OWNER" } });
      if (owners <= 1) throw new Error("CANNOT_REMOVE_OWNER");
    }

    const updated = await prisma.podcastMember.update({
      where: { podcastId_userId: { podcastId, userId: targetUserId } },
      data: { role },
      include: { user: { select: { id: true, fullName: true, email: true, avatar: true } }, podcast: { select: { id: true, name: true } } },
    });

    await AuditService.logAction({
      actorId,
      action: "PODCAST_MEMBER_ROLE_UPDATED",
      entityType: "Podcast",
      entityId: podcastId,
      newState: { targetUserId, previousRole: target.role, role },
      ipAddress: ip,
    });

    const roleLabels: Record<string, string> = { OWNER: "propriétaire", ADMIN: "administrateur", EDITOR: "éditeur", ANALYST: "analyste" };
    await NotificationService.notify([targetUserId], {
      type: "TEAM_ROLE_CHANGED",
      title: `Votre rôle a changé : ${updated.podcast.name}`,
      body: `Vous êtes maintenant ${roleLabels[role] || role} de ce podcast.`,
      link: `/studio/podcasts/${podcastId}`,
      actionLabel: "Ouvrir l’émission",
    }, { email: true });

    return updated;
  }

  static async removePodcastMember(actorId: string, podcastId: string, targetUserId: string, ip?: string) {
    const target = await prisma.podcastMember.findUnique({ where: { podcastId_userId: { podcastId, userId: targetUserId } } });
    if (!target) throw new Error("NOT_FOUND");

    if (target.role === "OWNER") {
      const owners = await prisma.podcastMember.count({ where: { podcastId, role: "OWNER" } });
      if (owners <= 1) throw new Error("CANNOT_REMOVE_OWNER");
    }

    await prisma.podcastMember.delete({ where: { podcastId_userId: { podcastId, userId: targetUserId } } });

    await AuditService.logAction({
      actorId,
      action: "PODCAST_MEMBER_REMOVED",
      entityType: "Podcast",
      entityId: podcastId,
      newState: { targetUserId, removedRole: target.role },
      ipAddress: ip,
    });

    const podcast = await prisma.podcast.findUnique({ where: { id: podcastId }, select: { name: true } });
    await NotificationService.notify([targetUserId], {
      type: "TEAM_REMOVED",
      title: `Vous ne faites plus partie de l'équipe : ${podcast?.name ?? "podcast"}`,
      body: `Votre accès collaborateur à ce podcast a été révoqué par l'administration.`,
      link: "/studio",
    }, { email: true });

    return { success: true, message: "Membre retiré de l'équipe avec succès." };
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
    // On limite le parallélisme pour ne pas exploser le pool de connexions (default: 10)
    const [
      episodesPublished,
      episodesThisWeek,
      pendingEpisodes,
      pendingPodcasts,
    ] = await Promise.all([
      prisma.episode.count({ where: { status: "PUBLISHED" } }),
      prisma.episode.count({ where: { status: "PUBLISHED", publishedAt: { gte: since7 } } }),
      prisma.episode.count({ where: { status: "PENDING_REVIEW" } }),
      prisma.podcast.count({ where: { status: "PENDING_REVIEW" } }),
    ]);

    const [
      pendingCreatorAccess,
      openReports,
      reportsByReason,
      activeListeners24h,
    ] = await Promise.all([
      prisma.creatorMarketAccess.count({ where: { status: "PENDING" } }),
      prisma.report.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
      prisma.report.groupBy({ by: ["reason"], where: { status: { in: ["OPEN", "IN_REVIEW"] } }, _count: { id: true } }),
      prisma.playbackHistory.groupBy({ by: ["userId"], where: { lastPlayedAt: { gte: since24h } } }).then((r) => r.length),
    ]);

    const [
      plays7d,
      storage,
      failedJobs,
      recentAudit,
    ] = await Promise.all([
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

  /** État du système, santé de la base, mémoire, et services d'arrière-plan. */
  static async getSystemHealth() {
    const startTime = Date.now();
    let dbStatus = "HEALTHY";
    let dbLatencyMs = 0;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - startTime;
    } catch {
      dbStatus = "DOWN";
    }

    const [usersCount, podcastsCount, episodesCount, mediaAssetsCount, pendingJobsCount, failedJobsCount] =
      await Promise.all([
        prisma.user.count(),
        prisma.podcast.count(),
        prisma.episode.count(),
        prisma.mediaAsset.count(),
        prisma.jobQueueItem.count({ where: { status: "PENDING" } }),
        prisma.jobQueueItem.count({ where: { status: "FAILED" } }),
      ]);

    const mem = process.memoryUsage();

    return {
      status: "ONLINE",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || "development",
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
        client: "PostgreSQL",
      },
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      },
      counts: {
        users: usersCount,
        podcasts: podcastsCount,
        episodes: episodesCount,
        mediaAssets: mediaAssetsCount,
        pendingJobs: pendingJobsCount,
        failedJobs: failedJobsCount,
      },
      services: [
        { name: "API HTTP REST (Express)", status: "OPERATIONAL", port: 8080 },
        { name: "PostgreSQL Database", status: dbStatus === "HEALTHY" ? "OPERATIONAL" : "DEGRADED" },
        { name: "Stockage Média S3 / Cloudflare R2", status: process.env.R2_ENDPOINT ? "OPERATIONAL" : "LOCAL_FALLBACK" },
        { name: "File de traitement (Job Queue Worker)", status: failedJobsCount > 5 ? "DEGRADED" : "OPERATIONAL" },
        { name: "Service de Vectorisation (Embeddings)", status: "OPERATIONAL" },
        { name: "Moteur de Transcription (Whisper)", status: process.env.OPENAI_API_KEY ? "CONFIGURED" : "STANDBY" },
      ],
    };
  }

  // ───────────────────────── VUE 360° UTILISATEUR & MONÉTISATION ─────────────────────────

  static async getUser360(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: { include: { role: true } },
        creatorProfile: {
          include: {
            country: true,
            _count: { select: { followers: true } },
          },
        },
        podcastMemberships: {
          include: {
            podcast: {
              select: {
                id: true,
                name: true,
                slug: true,
                cover: true,
                status: true,
                _count: { select: { episodes: true } },
              },
            },
          },
        },
        languagePreferences: { include: { language: true } },
        topicPreferences: { include: { topic: true } },
        countryPreferences: { include: { country: true } },
        notificationPreference: true,
        recommendationProfile: true,
        devices: {
          orderBy: { lastActiveAt: "desc" },
          take: 10,
        },
        sessions: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
        subscriptions: {
          orderBy: { createdAt: "desc" },
          include: { plan: true },
        },
        paymentTransactions: {
          orderBy: { createdAt: "desc" },
          take: 50,
          include: {
            subscription: { include: { plan: true } },
            episode: { select: { id: true, title: true, slug: true, cover: true } },
          },
        },
      },
    });

    if (!user) throw new Error("USER_NOT_FOUND");

    const [
      playbackHistories,
      savedEpisodes,
      playlists,
      podcastFollows,
      creatorFollows,
      userLikes,
      userComments,
      claimsCount,
      reportsCount,
      auditLogs,
    ] = await Promise.all([
      prisma.playbackHistory.findMany({
        where: { userId },
        orderBy: { lastPlayedAt: "desc" },
        take: 100,
        include: {
          episode: {
            select: {
              id: true,
              title: true,
              slug: true,
              cover: true,
              durationSeconds: true,
              isPremium: true,
              premiumPrice: true,
              podcast: {
                select: { id: true, name: true, slug: true, cover: true },
              },
            },
          },
        },
      }),
      prisma.savedEpisode.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          episode: {
            select: {
              id: true,
              title: true,
              slug: true,
              cover: true,
              durationSeconds: true,
              podcast: { select: { id: true, name: true, slug: true, cover: true } },
            },
          },
        },
      }),
      prisma.playlist.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        include: {
          _count: { select: { items: true } },
        },
      }),
      prisma.podcastFollow.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: {
          podcast: {
            select: {
              id: true,
              name: true,
              slug: true,
              cover: true,
              primaryLanguageCode: true,
              _count: { select: { episodes: true } },
            },
          },
        },
      }),
      prisma.creatorFollow.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: {
          creatorProfile: {
            select: {
              id: true,
              displayName: true,
              slug: true,
              avatar: true,
              isVerified: true,
            },
          },
        },
      }),
      prisma.episodeLike.count({ where: { userId } }),
      prisma.comment.count({ where: { userId } }),
      prisma.claim.count({ where: { userId } }),
      prisma.report.count({ where: { reporterId: userId } }),
      prisma.auditLog.findMany({
        where: {
          OR: [
            { actorId: userId },
            { entityId: userId },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

    // Calculs de consommation
    const totalListensCount = playbackHistories.length;
    const completedListensCount = playbackHistories.filter((h) => h.completed).length;
    const totalListenSeconds = playbackHistories.reduce((acc, h) => acc + (h.positionSeconds || 0), 0);
    const completionRate = totalListensCount > 0 ? Math.round((completedListensCount / totalListensCount) * 100) : 0;

    // Total monétisation dépensé
    const totalSpent = user.paymentTransactions
      .filter((t) => t.status === "SUCCESS")
      .reduce((acc, t) => acc + t.amount, 0);

    const now = new Date();
    const activeSubscription = user.subscriptions.find(
      (s) => s.status === SubscriptionStatus.ACTIVE && new Date(s.currentPeriodEnd) > now
    );

    // Podcasts les plus écoutés
    const podcastStatsMap = new Map<string, { id: string; name: string; slug: string; cover: string; plays: number; totalSeconds: number }>();
    for (const h of playbackHistories) {
      if (!h.episode?.podcast) continue;
      const pod = h.episode.podcast;
      const existing = podcastStatsMap.get(pod.id) || {
        id: pod.id,
        name: pod.name,
        slug: pod.slug,
        cover: pod.cover,
        plays: 0,
        totalSeconds: 0,
      };
      existing.plays += 1;
      existing.totalSeconds += h.positionSeconds || 0;
      podcastStatsMap.set(pod.id, existing);
    }
    const topListenedPodcasts = Array.from(podcastStatsMap.values())
      .sort((a, b) => b.totalSeconds - a.totalSeconds)
      .slice(0, 5);

    return {
      profile: {
        id: user.id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        avatar: user.avatar,
        isVerified: user.isVerified,
        isSuspended: user.isSuspended,
        suspendedAt: user.suspendedAt,
        suspendedReason: user.suspendedReason,
        createdAt: user.createdAt,
        roles: user.userRoles.map((ur) => ur.role.name),
        creatorProfile: user.creatorProfile,
        podcastMemberships: user.podcastMemberships,
      },
      monetization: {
        hasActiveSubscription: !!activeSubscription,
        activeSubscription,
        subscriptions: user.subscriptions,
        transactions: user.paymentTransactions,
        totalSpent,
        currency: "XOF",
      },
      analytics: {
        totalListenSeconds,
        totalListenHours: Math.round((totalListenSeconds / 3600) * 10) / 10,
        totalListensCount,
        completedListensCount,
        completionRate,
        topListenedPodcasts,
        likesCount: userLikes,
        commentsCount: userComments,
        savedCount: savedEpisodes.length,
        followsCount: podcastFollows.length,
        creatorFollowsCount: creatorFollows.length,
        playlistsCount: playlists.length,
      },
      preferences: {
        languages: user.languagePreferences.map((lp) => ({
          code: lp.languageCode,
          name: lp.language.name,
          nativeName: lp.language.nativeName,
        })),
        topics: user.topicPreferences.map((tp) => ({
          name: tp.topic.name,
          slug: tp.topic.slug,
        })),
        countries: user.countryPreferences.map((cp) => ({
          code: cp.country.code,
          name: cp.country.name,
          flagEmoji: cp.country.flagEmoji,
        })),
        notifications: user.notificationPreference,
        recommendationProfile: user.recommendationProfile,
      },
      activity: {
        recentPlaybackHistory: playbackHistories.slice(0, 40),
        savedEpisodes,
        playlists,
        podcastFollows,
        creatorFollows,
      },
      technical: {
        devices: user.devices,
        sessions: user.sessions,
        claimsCount,
        reportsCount,
        auditLogs,
      },
    };
  }

  static async listSubscriptionPlans() {
    let plans = await prisma.subscriptionPlan.findMany({
      orderBy: { price: "asc" },
      include: {
        _count: { select: { subscriptions: true } },
      },
    });

    if (plans.length === 0) {
      await prisma.subscriptionPlan.createMany({
        data: [
          {
            name: "Pass Bamako Podcast Illimité",
            slug: "pass-illimite-mensuel",
            price: 2000,
            currency: "XOF",
            interval: "MONTHLY",
            description: "Accès illimité à 100% des épisodes exclusifs, écoute sans coupure publicitaire et son haute définition.",
            features: [
              "Écoute sans coupures publicitaires",
              "Accès à tous les épisodes payants",
              "Téléchargement hors-ligne illimité",
              "Badge Auditeur VIP dans la communauté",
            ],
            isActive: true,
            scope: SubscriptionScope.PLATFORM,
          },
          {
            name: "Pass Annuel Privilège",
            slug: "pass-annuel-privilege",
            price: 20000,
            currency: "XOF",
            interval: "YEARLY",
            description: "12 mois d'accès illimité avec 2 mois offerts + invitations aux enregistrements live en studio à Bamako.",
            features: [
              "2 mois offerts chaque année",
              "Accès prioritaire aux avant-premières",
              "Invitations aux sessions live en studio",
              "Support VIP direct via WhatsApp",
            ],
            isActive: true,
            scope: SubscriptionScope.PLATFORM,
          },
          {
            name: "Soutien Créateur Mensuel",
            slug: "soutien-createur-mensuel",
            price: 1000,
            currency: "XOF",
            interval: "MONTHLY",
            description: "Abonnement direct pour soutenir les créateurs indépendants du Mali et accéder à leurs bonus exclusifs.",
            features: [
              "Épisodes bonus et coulisses réservés",
              "Salon de discussion privé avec les créateurs",
              "Accès anticipé 48h avant tout le monde",
            ],
            isActive: true,
            scope: SubscriptionScope.PLATFORM,
          },
        ],
      });

      plans = await prisma.subscriptionPlan.findMany({
        orderBy: { price: "asc" },
        include: {
          _count: { select: { subscriptions: true } },
        },
      });
    }

    return plans;
  }

  static async createSubscriptionPlan(
    actorId: string,
    data: {
      name: string;
      slug: string;
      description?: string;
      price: number;
      currency?: string;
      interval?: string;
      features: string[];
      scope?: SubscriptionScope;
      podcastId?: string;
    },
    ip?: string
  ) {
    const existing = await prisma.subscriptionPlan.findUnique({ where: { slug: data.slug } });
    if (existing) throw new Error("SLUG_ALREADY_EXISTS");

    const plan = await prisma.subscriptionPlan.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        price: data.price,
        currency: data.currency || "XOF",
        interval: data.interval || "MONTHLY",
        features: data.features || [],
        scope: data.scope || SubscriptionScope.PLATFORM,
        podcastId: data.podcastId,
      },
    });

    await AuditService.logAction({
      actorId,
      action: "CREATE_SUBSCRIPTION_PLAN",
      entityType: "SUBSCRIPTION_PLAN",
      entityId: plan.id,
      ipAddress: ip,
      newState: { name: plan.name, price: plan.price },
    });

    return plan;
  }

  static async grantUserSubscription(
    actorId: string,
    userId: string,
    data: { planId: string; durationDays?: number; paymentMethod?: string; note?: string },
    ip?: string
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("USER_NOT_FOUND");
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: data.planId } });
    if (!plan) throw new Error("PLAN_NOT_FOUND");

    const days = data.durationDays || (plan.interval === "YEARLY" ? 365 : 30);
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);

    const subscription = await prisma.$transaction(async (tx) => {
      await tx.userSubscription.updateMany({
        where: { userId, status: SubscriptionStatus.ACTIVE },
        data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
      });

      const sub = await tx.userSubscription.create({
        data: {
          userId,
          planId: plan.id,
          status: SubscriptionStatus.ACTIVE,
          paymentMethod: data.paymentMethod || "ADMIN_GRANT",
          currentPeriodStart: startDate,
          currentPeriodEnd: endDate,
        },
        include: { plan: true },
      });

      await tx.paymentTransaction.create({
        data: {
          userId,
          subscriptionId: sub.id,
          amount: plan.price,
          currency: plan.currency,
          status: "SUCCESS",
          paymentMethod: data.paymentMethod || "ADMIN_GRANT",
          transactionRef: `ADMIN-GRANT-${Date.now()}`,
          note: data.note || "Abonnement offert par la direction",
        },
      });

      await tx.notification.create({
        data: {
          userId,
          title: "Abonnement Premium activé !",
          body: `Votre formule « ${plan.name} » est active jusqu'au ${endDate.toLocaleDateString("fr-FR")}. Vous bénéficiez de tous les privilèges.`,
          link: "/premium",
          type: "SUBSCRIPTION_ACTIVATED",
        },
      });

      return sub;
    });

    await AuditService.logAction({
      actorId,
      action: "GRANT_USER_SUBSCRIPTION",
      entityType: "USER",
      entityId: userId,
      ipAddress: ip,
      newState: { planId: plan.id, planName: plan.name, durationDays: days, note: data.note },
    });

    return subscription;
  }

  static async cancelUserSubscription(actorId: string, subscriptionId: string, note?: string, ip?: string) {
    const sub = await prisma.userSubscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true, user: true },
    });
    if (!sub) throw new Error("SUBSCRIPTION_NOT_FOUND");

    const updated = await prisma.userSubscription.update({
      where: { id: subscriptionId },
      data: {
        status: SubscriptionStatus.CANCELED,
        canceledAt: new Date(),
      },
    });

    await AuditService.logAction({
      actorId,
      action: "CANCEL_USER_SUBSCRIPTION",
      entityType: "USER_SUBSCRIPTION",
      entityId: subscriptionId,
      ipAddress: ip,
      newState: { userId: sub.userId, planName: sub.plan.name, note },
    });

    return updated;
  }

  static async revokeUserSessions(actorId: string, userId: string, ip?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("USER_NOT_FOUND");

    const [deletedSessions, deletedRefresh] = await Promise.all([
      prisma.session.deleteMany({ where: { userId } }),
      prisma.refreshToken.deleteMany({ where: { userId } }),
    ]);

    await AuditService.logAction({
      actorId,
      action: "REVOKE_USER_SESSIONS",
      entityType: "USER",
      entityId: userId,
      ipAddress: ip,
      newState: { deletedSessionsCount: deletedSessions.count, deletedRefreshCount: deletedRefresh.count },
    });

    return { revokedCount: deletedSessions.count + deletedRefresh.count };
  }
}

