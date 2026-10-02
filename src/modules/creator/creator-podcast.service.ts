import { prisma } from "../../config/prisma.js";
import { slugify } from "./creator-profile.service.js";
import { MarketService } from "../markets/market.service.js";
import { PodcastMemberRole, PodcastStatus } from "@prisma/client";
import { ContentReviewService } from "../../services/content-review.service.js";

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
        status: (await ContentReviewService.requiresReview(userId)) ? PodcastStatus.PENDING_REVIEW : PodcastStatus.PUBLISHED,
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

    // Le statut est piloté par la modération : un créateur ne peut ni lever une suspension,
    // ni court-circuiter la validation, ni s'auto-approuver.
    // Liste blanche : le corps de la requête n'est jamais répandu tel quel dans la base
    // (sinon un créateur pourrait s'attribuer isOfficial, ownershipStatus, qualityScore…).
    const input = data as Record<string, any>;
    const requestedStatus = input.status as PodcastStatus | undefined;
    const rest: Record<string, any> = {};
    for (const key of ["name", "description", "shortDescription", "cover", "banner", "countryId", "primaryLanguageCode", "website", "city"]) {
      if (input[key] !== undefined) rest[key] = input[key];
    }
    const categoryIds: string[] | undefined = Array.isArray(input.categoryIds) ? input.categoryIds : undefined;
    const topicIds: string[] | undefined = Array.isArray(input.topicIds) ? input.topicIds : undefined;
    let statusChange: { status: PodcastStatus } | undefined;
    if (requestedStatus) {
      const current = await prisma.podcast.findUnique({ where: { id: podcastId }, select: { status: true } });
      if (!current) throw new Error("PODCAST_NOT_FOUND");
      if (current.status === "SUSPENDED") throw new Error("FORBIDDEN");
      const creatorAllowed: PodcastStatus[] = ["DRAFT", "UNLISTED", "ARCHIVED"];
      if (creatorAllowed.includes(requestedStatus)) {
        statusChange = { status: requestedStatus };
      } else if (requestedStatus === "PUBLISHED" || requestedStatus === "PENDING_REVIEW") {
        if (current.status !== "PENDING_REVIEW") {
          statusChange = { status: (await ContentReviewService.requiresReview(userId)) ? "PENDING_REVIEW" : "PUBLISHED" };
        }
      } else {
        throw new Error("FORBIDDEN");
      }
    }

    return prisma.$transaction(async (tx) => {
      if (categoryIds) {
        await tx.podcastCategory.deleteMany({ where: { podcastId } });
        await tx.podcastCategory.createMany({ data: categoryIds.map((categoryId) => ({ podcastId, categoryId })), skipDuplicates: true });
      }
      if (topicIds) {
        await tx.podcastTopic.deleteMany({ where: { podcastId } });
        await tx.podcastTopic.createMany({ data: topicIds.map((topicId) => ({ podcastId, topicId })), skipDuplicates: true });
      }
      return tx.podcast.update({
        where: { id: podcastId },
        data: {
          ...rest,
          ...(statusChange ?? {}),
          ...(newSlug ? { slug: newSlug } : {}),
        },
        include: { categories: { include: { category: true } }, topics: { include: { topic: true } } },
      });
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
