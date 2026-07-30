import { prisma } from "../../config/prisma.js";
import { slugify } from "../creator/creator-profile.service.js";
import { MediaResolverService } from "../creator/media-resolver.service.js";
import { AuditService } from "../../services/audit.service.js";
import { PodcastOwnershipStatus, CreationSource, PodcastStatus } from "@prisma/client";

export class AdminCatalogService {
  static async getCatalog(filters: {
    countryId?: string;
    languageCode?: string;
    categoryId?: string;
    status?: PodcastStatus;
    ownershipStatus?: PodcastOwnershipStatus;
    creationSource?: CreationSource;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filters.countryId) where.countryId = filters.countryId;
    if (filters.languageCode) where.primaryLanguageCode = filters.languageCode;
    if (filters.status) where.status = filters.status;
    if (filters.ownershipStatus) where.ownershipStatus = filters.ownershipStatus;
    if (filters.creationSource) where.creationSource = filters.creationSource;
    if (filters.categoryId) {
      where.categories = { some: { categoryId: filters.categoryId } };
    }
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.podcast.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          country: true,
          primaryLanguage: true,
          categories: { include: { category: true } },
          rssFeed: true,
          _count: { select: { episodes: true, followers: true, claims: true } },
        },
      }),
      prisma.podcast.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async createAdminPodcast(
    adminUserId: string,
    data: {
      name: string;
      description: string;
      shortDescription?: string;
      cover: string;
      banner?: string;
      countryId?: string;
      primaryLanguageCode?: string;
      city?: string;
      website?: string;
      organizationId?: string;
      categoryIds?: string[];
      topicIds?: string[];
      ownershipStatus?: PodcastOwnershipStatus;
    }
  ) {
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
        countryId: data.countryId || "ML",
        primaryLanguageCode: data.primaryLanguageCode || "fr",
        city: data.city,
        website: data.website,
        organizationId: data.organizationId,
        status: PodcastStatus.PUBLISHED,
        ownershipStatus: data.ownershipStatus || PodcastOwnershipStatus.UNCLAIMED,
        creationSource: CreationSource.ADMIN,
        managedByBamakoPodcast: true,
        qualityScore: 85,
        ...(data.categoryIds
          ? { categories: { create: data.categoryIds.map((categoryId) => ({ categoryId })) } }
          : {}),
        ...(data.topicIds
          ? { topics: { create: data.topicIds.map((topicId) => ({ topicId })) } }
          : {}),
      },
      include: { country: true, primaryLanguage: true },
    });

    await AuditService.logAction({
      actorId: adminUserId,
      action: "PODCAST_CREATED_ADMIN",
      entityType: "PODCAST",
      entityId: podcast.id,
      newState: podcast,
    });

    return podcast;
  }

  static async addFromUrlPreview(url: string) {
    const resolved = MediaResolverService.resolveUrl(url);

    return {
      url,
      provider: resolved.provider,
      type: resolved.type,
      playbackMode: resolved.playbackMode,
      externalId: resolved.externalId,
      embedUrl: resolved.embedUrl,
      suggestedName: `Podcast ${resolved.provider}`,
      suggestedDescription: `Contenu pré-rempli depuis ${resolved.provider}.`,
      suggestedCover: "https://bamakopodcast.studio/images/image1.jpg",
    };
  }

  static async detectDuplicates(name: string, rssUrl?: string) {
    const suggestions = [];

    if (rssUrl) {
      const byRss = await prisma.rssFeed.findFirst({
        where: { url: rssUrl },
        include: { podcast: true },
      });
      if (byRss) suggestions.push({ reason: "MÊME_FLUX_RSS", podcast: byRss.podcast });
    }

    const byName = await prisma.podcast.findMany({
      where: { name: { contains: name.trim(), mode: "insensitive" } },
      take: 5,
    });

    for (const p of byName) {
      if (!suggestions.some((s) => s.podcast.id === p.id)) {
        suggestions.push({ reason: "NOM_SIMILAIRE", podcast: p });
      }
    }

    return suggestions;
  }

  static async mergePodcasts(adminUserId: string, primaryId: string, duplicateId: string) {
    if (primaryId === duplicateId) throw new Error("MERGE_SAME_PODCAST");

    const [primary, duplicate] = await Promise.all([
      prisma.podcast.findUnique({ where: { id: primaryId } }),
      prisma.podcast.findUnique({ where: { id: duplicateId } }),
    ]);

    if (!primary || !duplicate) throw new Error("PODCAST_NOT_FOUND");

    await prisma.$transaction(async (tx) => {
      // 1. Déplacer les épisodes
      await tx.episode.updateMany({
        where: { podcastId: duplicateId },
        data: { podcastId: primaryId },
      });

      // 2. Déplacer les followers
      const duplicateFollows = await tx.podcastFollow.findMany({ where: { podcastId: duplicateId } });
      for (const f of duplicateFollows) {
        await tx.podcastFollow.upsert({
          where: { userId_podcastId: { userId: f.userId, podcastId: primaryId } },
          update: {},
          create: { userId: f.userId, podcastId: primaryId },
        });
      }
      await tx.podcastFollow.deleteMany({ where: { podcastId: duplicateId } });

      // 3. Déplacer les membres & invitations
      const duplicateMembers = await tx.podcastMember.findMany({ where: { podcastId: duplicateId } });
      for (const m of duplicateMembers) {
        await tx.podcastMember.upsert({
          where: { podcastId_userId: { podcastId: primaryId, userId: m.userId } },
          update: {},
          create: { podcastId: primaryId, userId: m.userId, role: m.role },
        });
      }
      await tx.podcastMember.deleteMany({ where: { podcastId: duplicateId } });

      // 4. Redirection du slug
      await tx.slugRedirect.create({
        data: {
          entityType: "PODCAST",
          oldSlug: duplicate.slug,
          newSlug: primary.slug,
          targetId: primaryId,
        },
      });

      // 5. Supprimer le doublon
      await tx.podcast.delete({ where: { id: duplicateId } });
    });

    await AuditService.logAction({
      actorId: adminUserId,
      action: "PODCAST_MERGED",
      entityType: "PODCAST",
      entityId: primaryId,
      previousState: { duplicateId },
      newState: { primaryId },
    });

    return { success: true, message: `Podcast ${duplicate.name} fusionné avec succès dans ${primary.name}.` };
  }

  static async getContentHealth() {
    const [
      podcastsWithoutCover,
      podcastsWithoutCategory,
      episodesWithoutMedia,
      rssErrors,
      failedMediaAssets,
    ] = await Promise.all([
      prisma.podcast.count({ where: { cover: "" } }),
      prisma.podcast.count({ where: { categories: { none: {} } } }),
      prisma.episode.count({ where: { mediaSources: { none: {} } } }),
      prisma.rssFeed.count({ where: { syncStatus: "ERROR" } }),
      prisma.mediaAsset.count({ where: { status: "FAILED" } }),
    ]);

    return {
      podcastsWithoutCover,
      podcastsWithoutCategory,
      episodesWithoutMedia,
      rssErrors,
      failedMediaAssets,
    };
  }
}
