import { prisma } from "../../config/prisma.js";
import { slugify } from "./creator-profile.service.js";
import { MarketService } from "../markets/market.service.js";
import { PodcastMemberRole, PodcastStatus } from "@prisma/client";

export class CreatorPodcastService {
  static async listCreatorPodcasts(userId: string) {
    const memberships = await prisma.podcastMember.findMany({
      where: { userId },
      include: {
        podcast: {
          include: {
            country: true,
            primaryLanguage: true,
            _count: { select: { episodes: true, followers: true } },
          },
        },
      },
    });

    return memberships.map((m) => ({
      ...m.podcast,
      role: m.role,
    }));
  }

  static async getPodcastById(userId: string, podcastId: string) {
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });

    if (!member) throw new Error("FORBIDDEN");

    const podcast = await prisma.podcast.findUnique({
      where: { id: podcastId },
      include: {
        country: true,
        primaryLanguage: true,
        categories: { include: { category: true } },
        topics: { include: { topic: true } },
        members: { include: { user: { select: { id: true, fullName: true, email: true, avatar: true } } } },
        seasons: { orderBy: { number: "asc" } },
        _count: { select: { episodes: true, followers: true } },
      },
    });

    return { ...podcast, userRole: member.role };
  }

  static async createPodcast(
    userId: string,
    data: {
      name: string;
      description: string;
      shortDescription?: string;
      cover: string;
      banner?: string;
      countryId?: string;
      primaryLanguageCode?: string;
      categoryIds?: string[];
      topicIds?: string[];
      website?: string;
    }
  ) {
    const countryCode = data.countryId || "ML";
    const creatorProfile = await prisma.creatorProfile.findUnique({ where: { userId } });

    // Validation Marché : Vérifier que la création de podcast est autorisée dans ce pays
    const isAllowed = await MarketService.checkCapability(
      countryCode,
      "podcastCreationEnabled",
      creatorProfile?.id
    );

    if (!isAllowed) {
      throw new Error("MARKET_NOT_OPEN_FOR_CREATORS");
    }

    let slugBase = slugify(data.name);
    let slug = slugBase;
    let count = 1;

    while (await prisma.podcast.findUnique({ where: { slug } })) {
      count++;
      slug = `${slugBase}-${count}`;
    }

    const podcast = await prisma.podcast.create({
      data: {
        name: data.name,
        slug,
        description: data.description,
        shortDescription: data.shortDescription,
        cover: data.cover,
        banner: data.banner,
        countryId: countryCode,
        primaryLanguageCode: data.primaryLanguageCode || "fr",
        status: PodcastStatus.PUBLISHED,
        ownershipStatus: "CLAIMED",
        creationSource: "CREATOR",
        website: data.website,
        members: {
          create: {
            userId,
            role: PodcastMemberRole.OWNER,
          },
        },
        ...(data.categoryIds
          ? {
              categories: {
                create: data.categoryIds.map((categoryId) => ({ categoryId })),
              },
            }
          : {}),
        ...(data.topicIds
          ? {
              topics: {
                create: data.topicIds.map((topicId) => ({ topicId })),
              },
            }
          : {}),
      },
      include: {
        country: true,
        primaryLanguage: true,
        categories: { include: { category: true } },
        topics: { include: { topic: true } },
      },
    });

    return podcast;
  }

  static async updatePodcast(
    userId: string,
    podcastId: string,
    data: {
      name?: string;
      description?: string;
      shortDescription?: string;
      cover?: string;
      banner?: string;
      countryId?: string;
      primaryLanguageCode?: string;
      website?: string;
      status?: PodcastStatus;
    }
  ) {
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });

    if (!member || (member.role !== "OWNER" && member.role !== "ADMIN" && member.role !== "EDITOR")) {
      throw new Error("FORBIDDEN");
    }

    // Gestion de la modification du Slug avec SlugRedirect
    let newSlug = undefined;
    if (data.name) {
      const existingPodcast = await prisma.podcast.findUnique({ where: { id: podcastId } });
      if (existingPodcast && existingPodcast.name !== data.name) {
        let slugBase = slugify(data.name);
        newSlug = slugBase;
        let count = 1;
        while (await prisma.podcast.findUnique({ where: { slug: newSlug } })) {
          count++;
          newSlug = `${slugBase}-${count}`;
        }

        await prisma.slugRedirect.create({
          data: {
            entityType: "PODCAST",
            oldSlug: existingPodcast.slug,
            newSlug: newSlug,
            targetId: podcastId,
          },
        });
      }
    }

    return prisma.podcast.update({
      where: { id: podcastId },
      data: {
        ...data,
        ...(newSlug ? { slug: newSlug } : {}),
      },
    });
  }

  static async archivePodcast(userId: string, podcastId: string) {
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });

    if (!member || member.role !== "OWNER") {
      throw new Error("FORBIDDEN_ONLY_OWNER");
    }

    return prisma.podcast.update({
      where: { id: podcastId },
      data: { status: PodcastStatus.ARCHIVED },
    });
  }
}
