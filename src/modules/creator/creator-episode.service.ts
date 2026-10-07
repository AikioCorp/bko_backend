import { prisma } from "../../config/prisma.js";
import { slugify } from "./creator-profile.service.js";
import { MediaResolverService } from "./media-resolver.service.js";
import { MarketService } from "../markets/market.service.js";
import { EpisodeStatus, MediaType } from "@prisma/client";
import { NotificationService } from "../../services/notification.service.js";
import { ContentReviewService } from "../../services/content-review.service.js";
import { EpisodePublishValidationService } from "../../services/episode-publish-validation.service.js";

export class CreatorEpisodeService {
  static async listAllEpisodes(
    userId: string,
    filters?: { podcastId?: string; status?: EpisodeStatus; search?: string }
  ) {
    const memberships = await prisma.podcastMember.findMany({
      where: { userId },
      select: { podcastId: true },
    });
    const allowedPodcastIds = memberships.map((m) => m.podcastId);
    if (allowedPodcastIds.length === 0) return [];

    const targetPodcastIds = filters?.podcastId
      ? allowedPodcastIds.filter((id) => id === filters.podcastId)
      : allowedPodcastIds;

    if (targetPodcastIds.length === 0) return [];

    const where: any = {
      podcastId: { in: targetPodcastIds },
      ...(filters?.status ? { status: filters.status } : {}),
    };

    if (filters?.search) {
      where.OR = [
        { title: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    return prisma.episode.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        podcast: {
          select: { id: true, name: true, slug: true, cover: true, status: true },
        },
        mediaSources: {
          include: { mediaAsset: true },
        },
        season: true,
      },
    });
  }

  static async listEpisodes(userId: string, podcastId: string, status?: EpisodeStatus) {
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });
    if (!member) throw new Error("FORBIDDEN");

    return prisma.episode.findMany({
      where: {
        podcastId,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        podcast: {
          select: { id: true, name: true, slug: true, cover: true, status: true },
        },
        mediaSources: {
          include: { mediaAsset: true },
        },
        season: true,
        people: { include: { person: true } },
      },
    });
  }

  static async createEpisode(
    userId: string,
    podcastId: string,
    data: {
      title: string;
      description: string;
      cover?: string;
      seasonId?: string;
      episodeNumber?: number;
      languageCode?: string;
      topicIds?: string[];
      peopleIds?: Array<{ personId: string; role?: any }>;
      status?: EpisodeStatus;
    }
  ) {
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });
    if (!member || member.role === "ANALYST") throw new Error("FORBIDDEN");

    let slugBase = slugify(data.title);
    let slug = slugBase;
    let count = 1;

    while (await prisma.episode.findUnique({ where: { podcastId_slug: { podcastId, slug } } })) {
      count++;
      slug = `${slugBase}-${count}`;
    }

    const episode = await prisma.episode.create({
      data: {
        podcastId,
        title: data.title,
        slug,
        description: data.description,
        cover: data.cover,
        seasonId: data.seasonId,
        episodeNumber: data.episodeNumber,
        languageCode: data.languageCode || "fr",
        // Toujours brouillon : la publication passe par publish/schedule (média prêt, validation, marché).
        status: EpisodeStatus.DRAFT,
        ...(data.topicIds
          ? {
              topics: {
                create: data.topicIds.map((topicId) => ({ topicId })),
              },
            }
          : {}),
        ...(data.peopleIds
          ? {
              people: {
                create: data.peopleIds.map((p) => ({ personId: p.personId, role: p.role || "GUEST" })),
              },
            }
          : {}),
      },
      include: {
        mediaSources: true,
        season: true,
        people: { include: { person: true } },
      },
    });

    return episode;
  }

  static async addMediaSource(
    userId: string,
    episodeId: string,
    data: {
      rawUrl: string;
      mediaTypePreference?: MediaType;
      isPrimaryAudio?: boolean;
      isPrimaryVideo?: boolean;
    }
  ) {
    const episode = await prisma.episode.findUnique({ where: { id: episodeId } });
    if (!episode) throw new Error("EPISODE_NOT_FOUND");

    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId: episode.podcastId, userId } },
    });
    if (!member || member.role === "ANALYST") throw new Error("FORBIDDEN");

    const resolved = MediaResolverService.resolveUrl(data.rawUrl, data.mediaTypePreference);

    return prisma.$transaction(async (tx) => {
      if (data.isPrimaryAudio) {
        await tx.mediaSource.updateMany({
          where: { episodeId, isPrimaryAudio: true },
          data: { isPrimaryAudio: false },
        });
      }
      if (data.isPrimaryVideo) {
        await tx.mediaSource.updateMany({
          where: { episodeId, isPrimaryVideo: true },
          data: { isPrimaryVideo: false },
        });
      }

      return tx.mediaSource.create({
        data: {
          episodeId,
          type: resolved.type,
          sourceType: "EXTERNAL",
          provider: resolved.provider,
          playbackMode: resolved.playbackMode,
          externalUrl: resolved.externalUrl,
          embedUrl: resolved.embedUrl,
          externalId: resolved.externalId,
          isPrimaryAudio: data.isPrimaryAudio ?? resolved.type === "AUDIO",
          isPrimaryVideo: data.isPrimaryVideo ?? resolved.type === "VIDEO",
        },
      });
    });
  }

  static async publishEpisode(userId: string, episodeId: string) {
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      include: { podcast: true },
    });
    if (!episode) throw new Error("EPISODE_NOT_FOUND");

    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId: episode.podcastId, userId } },
    });
    if (!member || member.role === "ANALYST") throw new Error("FORBIDDEN");

    // Validation unifiée de la checklist (titre, description, podcast actif, médias prêts, marché)
    await EpisodePublishValidationService.assertCanPublish(episodeId, {
      userId,
      checkMarket: true,
    });

    // Annule une éventuelle programmation précédente
    await prisma.jobQueueItem.updateMany({
      where: { queueName: "episodes-publisher", status: "PENDING", payload: { path: ["episodeId"], equals: episodeId } },
      data: { status: "CANCELLED" },
    }).catch(() => {});

    // Modération a priori (optionnelle) : l'épisode attend la validation de l'administration.
    if (await ContentReviewService.requiresReview(userId)) {
      return prisma.episode.update({
        where: { id: episodeId },
        data: { status: EpisodeStatus.PENDING_REVIEW, reviewNote: null },
      });
    }

    const published = await prisma.episode.update({
      where: { id: episodeId },
      data: {
        status: EpisodeStatus.PUBLISHED,
        publishedAt: episode.publishedAt && episode.status === EpisodeStatus.PUBLISHED ? episode.publishedAt : new Date(),
      },
    });
    await NotificationService.notifyFollowersOfEpisode(episodeId);
    return published;
  }

  static async scheduleEpisode(userId: string, episodeId: string, publishAt: string) {
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      include: { podcast: true },
    });
    if (!episode) throw new Error("EPISODE_NOT_FOUND");

    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId: episode.podcastId, userId } },
    });
    if (!member || member.role === "ANALYST") throw new Error("FORBIDDEN");

    const scheduledDate = new Date(publishAt);
    if (isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now() + 60_000) {
      throw new Error("INVALID_SCHEDULE_DATE");
    }

    // Validation unifiée de la checklist (titre, description, podcast actif, médias prêts, marché)
    await EpisodePublishValidationService.assertCanPublish(episodeId, {
      userId,
      checkMarket: true,
    });

    // Annule une éventuelle programmation précédente
    await prisma.jobQueueItem.updateMany({
      where: { queueName: "episodes-publisher", status: "PENDING", payload: { path: ["episodeId"], equals: episodeId } },
      data: { status: "CANCELLED" },
    }).catch(() => {});

    // Créateur soumis à validation : la date visée est conservée ; l'admin programmera à l'approbation.
    if (await ContentReviewService.requiresReview(userId)) {
      return prisma.episode.update({
        where: { id: episodeId },
        data: { status: EpisodeStatus.PENDING_REVIEW, publishedAt: scheduledDate, reviewNote: null },
      });
    }

    await prisma.jobQueueItem.create({
      data: {
        queueName: "episodes-publisher",
        jobType: "PUBLISH_EPISODE",
        payload: { episodeId },
        runAt: scheduledDate,
      },
    });

    return prisma.episode.update({
      where: { id: episodeId },
      data: {
        status: EpisodeStatus.SCHEDULED,
        publishedAt: scheduledDate,
      },
    });
  }
}
