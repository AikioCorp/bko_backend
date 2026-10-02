import { prisma } from "../../config/prisma.js";
import { slugify } from "./creator-profile.service.js";
import { MediaResolverService } from "./media-resolver.service.js";
import { MarketService } from "../markets/market.service.js";
import { EpisodeStatus, MediaType } from "@prisma/client";
import { NotificationService } from "../../services/notification.service.js";
import { ContentReviewService } from "../../services/content-review.service.js";

export class CreatorEpisodeService {
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
        mediaSources: true,
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
      include: { podcast: true, mediaSources: true },
    });
    if (!episode) throw new Error("EPISODE_NOT_FOUND");

    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId: episode.podcastId, userId } },
    });
    if (!member || member.role === "ANALYST") throw new Error("FORBIDDEN");

    // Validation du Marché : La publication doit être activée dans le pays du podcast
    const creatorProfile = await prisma.creatorProfile.findUnique({ where: { userId } });
    const canPublish = await MarketService.checkCapability(
      episode.podcast.countryId,
      "publishingEnabled",
      creatorProfile?.id
    );

    if (!canPublish) {
      throw new Error("MARKET_PUBLISHING_DISABLED");
    }

    if (!episode.title || !episode.description) {
      throw new Error("VALIDATION_ERROR_MISSING_FIELDS");
    }
    if (episode.mediaSources.length === 0) {
      throw new Error("VALIDATION_ERROR_NO_MEDIA_SOURCE");
    }
    // Un fichier encore en traitement ou en échec ne peut pas être publié.
    const assetIds = episode.mediaSources.map((m) => m.mediaAssetId).filter((id): id is string => !!id);
    if (assetIds.length) {
      const notReady = await prisma.mediaAsset.count({ where: { id: { in: assetIds }, status: { not: "READY" } } });
      if (notReady > 0) throw new Error("MEDIA_NOT_READY");
    }

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
        publishedAt: new Date(),
      },
    });
    await NotificationService.notifyFollowersOfEpisode(episodeId);
    return published;
  }

  static async scheduleEpisode(userId: string, episodeId: string, publishAt: string) {
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      include: { mediaSources: true },
    });
    if (!episode) throw new Error("EPISODE_NOT_FOUND");

    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId: episode.podcastId, userId } },
    });
    if (!member || member.role === "ANALYST") throw new Error("FORBIDDEN");

    const scheduledDate = new Date(publishAt);
    if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
      throw new Error("INVALID_SCHEDULE_DATE");
    }

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
