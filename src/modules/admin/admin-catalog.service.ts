import { prisma } from "../../config/prisma.js";
import { slugify } from "../creator/creator-profile.service.js";
import { MediaResolverService } from "../creator/media-resolver.service.js";
import { AuditService } from "../../services/audit.service.js";
import { PodcastOwnershipStatus, CreationSource, PodcastStatus, MediaSourceType } from "@prisma/client";
import { AdminEpisodeService } from "./admin-episode.service.js";

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
      const cleanSearch = filters.search.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const slugSearch = cleanSearch.toLowerCase().replace(/['’\s]+/g, '-');
        where.OR = [
          { name: { contains: filters.search, mode: "insensitive" } },
          { name: { contains: cleanSearch, mode: "insensitive" } },
          { slug: { contains: slugSearch, mode: "insensitive" } },
          { slug: { contains: cleanSearch.replace(/[^a-zA-Z0-9]/g, ''), mode: "insensitive" } },
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
          _count: { select: { episodes: true } },
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

  static async getPodcastById(idOrSlug: string) {
    return prisma.podcast.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: {
        country: true,
        organization: true,
        primaryLanguage: true,
        categories: { include: { category: true } },
        rssFeed: true,
        permanentPersons: { include: { person: true } },
        _count: { select: { episodes: true, followers: true, claims: true } },
      },
    });
  }

  static async getEpisodeById(idOrSlug: string) {
    return prisma.episode.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: {
        podcast: { select: { id: true, name: true, slug: true, cover: true } },
        mediaSources: true,
        transcripts: true,
        chapters: { orderBy: { startTimeMs: 'asc' } }
      }
    });
  }

  static async createAdminEpisode(adminId: string, idOrSlug: string, data: any) {
    const podcast = await prisma.podcast.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
    if (!podcast) throw new Error("Podcast introuvable");
    const slug = (data.title || "episode").toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Math.random().toString(36).substr(2, 5);

    let mediaSourceData = undefined;
    if (data.url) {
      try {
        const resolved = MediaResolverService.resolveUrl(data.url);
        mediaSourceData = {
          create: [{
            type: resolved.type,
            sourceType: MediaSourceType.EXTERNAL,
            provider: resolved.provider,
            playbackMode: resolved.playbackMode,
            externalUrl: resolved.externalUrl,
            embedUrl: resolved.embedUrl,
            externalId: resolved.externalId,
            isPrimaryVideo: resolved.type === "VIDEO",
            isPrimaryAudio: resolved.type === "AUDIO",
          }]
        };
      } catch (e) {
        // Ignorer si URL invalide
      }
    }

    return prisma.episode.create({
      data: {
        podcastId: podcast.id,
        title: data.title,
        slug,
        description: data.description || "",
        status: data.status || "DRAFT",
        creationSource: "ADMIN",
        ...(mediaSourceData ? { mediaSources: mediaSourceData } : {})
      }
    });
  }

  static async listAllEpisodes(skip = 0, take = 50, search = "") {
    const cleanSearch = search ? search.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
      const slugSearch = cleanSearch.toLowerCase().replace(/['’\s]+/g, '-');
      const where = search ? {
        OR: [
          { title: { contains: search, mode: 'insensitive' as const } },
          { slug: { contains: slugSearch, mode: 'insensitive' as const } },
          { podcast: { name: { contains: search, mode: 'insensitive' as const } } },
          { podcast: { slug: { contains: slugSearch, mode: 'insensitive' as const } } }
        ]
      } : {};
    const [data, total] = await Promise.all([
      prisma.episode.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          podcast: { select: { name: true, slug: true, cover: true } },
          _count: { select: { histories: true } }
        }
      }),
      prisma.episode.count({ where })
    ]);
    return { data, total };
  }

  static async listEpisodes(idOrSlug: string) {
    const podcast = await prisma.podcast.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
    if (!podcast) return [];
    return prisma.episode.findMany({
      where: { podcastId: podcast.id },
      orderBy: { createdAt: "desc" },
      include: {
        mediaSources: true,
      }
    });
  }

  static async updateAdminEpisode(adminId: string, idOrSlug: string, data: any) {
    const episode = await prisma.episode.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
    if (!episode) throw new Error("Épisode introuvable");

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.slug !== undefined) updateData.slug = data.slug;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.cover !== undefined) updateData.cover = data.cover;
    if (data.episodeNumber !== undefined) updateData.episodeNumber = data.episodeNumber ? Number(data.episodeNumber) : null;

    // Transition vers PUBLISHED : délègue au service unifié avec validation de la checklist
    if (data.status === "PUBLISHED" && episode.status !== "PUBLISHED") {
      await AdminEpisodeService.publish(adminId, episode.id, { mode: "now" });
    } else if (data.status === "DRAFT" && episode.status !== "DRAFT") {
      updateData.status = "DRAFT";
      await prisma.jobQueueItem.updateMany({
        where: { queueName: "episodes-publisher", status: "PENDING", payload: { path: ["episodeId"], equals: episode.id } },
        data: { status: "CANCELLED" },
      }).catch(() => {});
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.episode.update({
        where: { id: episode.id },
        data: updateData,
      });
    }

    return AdminEpisodeService.get(episode.id);
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
      status?: PodcastStatus;
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
        status: data.status || PodcastStatus.DRAFT,
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

  static async updateAdminPodcast(adminUserId: string, idOrSlug: string, data: any) {
    const podcast = await prisma.podcast.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
    if (!podcast) throw new Error("Podcast introuvable");

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.shortDescription !== undefined) updateData.shortDescription = data.shortDescription;
    if (data.cover !== undefined) updateData.cover = data.cover;
    if (data.countryId !== undefined) updateData.countryId = data.countryId;
    if (data.primaryLanguageCode !== undefined) updateData.primaryLanguageCode = data.primaryLanguageCode;
    if (data.website !== undefined) updateData.website = data.website;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.organizationId !== undefined) updateData.organizationId = data.organizationId || null;
    if (data.ownershipStatus !== undefined) updateData.ownershipStatus = data.ownershipStatus;
    if (data.managedByBamakoPodcast !== undefined) updateData.managedByBamakoPodcast = data.managedByBamakoPodcast;
    if (data.isOfficial !== undefined) updateData.isOfficial = data.isOfficial;
    if (data.redirectUrl !== undefined) updateData.redirectUrl = data.redirectUrl || null;

    const updated = await prisma.podcast.update({
      where: { id: podcast.id },
      data: updateData,
    });

    if (data.categoryIds !== undefined && Array.isArray(data.categoryIds)) {
      await prisma.podcastCategory.deleteMany({ where: { podcastId: podcast.id } });
      if (data.categoryIds.length > 0) {
        await prisma.podcastCategory.createMany({
          data: data.categoryIds.map((catId: string) => ({ podcastId: podcast.id, categoryId: catId })),
        });
      }
    }

    await AuditService.logAction({
      actorId: adminUserId,
      action: "PODCAST_UPDATED_ADMIN",
      entityType: "PODCAST",
      entityId: podcast.id,
      previousState: podcast,
      newState: updated,
    });

    return updated;
  }

  static async deleteAdminPodcast(adminUserId: string, idOrSlug: string) {
    const podcast = await prisma.podcast.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
    if (!podcast) throw new Error("Podcast introuvable");

    await prisma.podcast.delete({ where: { id: podcast.id } });

    await AuditService.logAction({
      actorId: adminUserId,
      action: "PODCAST_DELETED_ADMIN",
      entityType: "PODCAST",
      entityId: podcast.id,
      previousState: podcast,
    });

    return { success: true };
  }

  static async addFromUrlPreview(url: string) {
    const resolved = MediaResolverService.resolveUrl(url);
    
    let suggestedName = `Podcast ${resolved.provider}`;
    let suggestedCover = "https://bamakopodcast.studio/images/image1.jpg";
    let suggestedDescription = `Contenu pré-rempli depuis ${resolved.provider}.`;

    if (resolved.provider === "YOUTUBE" && resolved.externalId) {
      try {
        const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${resolved.externalId}&format=json`);
        if (oembedRes.ok) {
          const data = await oembedRes.json();
          if (data.title) suggestedName = data.title;
          if (data.thumbnail_url) suggestedCover = data.thumbnail_url;
          suggestedDescription = data.author_name ? `Vidéo YouTube de la chaîne ${data.author_name}.` : "Vidéo YouTube.";
        }
      } catch (e) {
        // Ignorer
      }
    }

    return {
      url,
      provider: resolved.provider,
      type: resolved.type,
      playbackMode: resolved.playbackMode,
      externalId: resolved.externalId,
      embedUrl: resolved.embedUrl,
      suggestedName,
      suggestedDescription,
      suggestedCover,
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
