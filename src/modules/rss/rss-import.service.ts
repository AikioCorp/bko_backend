import { prisma } from "../../config/prisma.js";
import { SsrfProtectionService } from "../../services/ssrf-protection.service.js";
import { RssParserService } from "./rss-parser.service.js";
import { MarketAccessService } from "../../services/market-access.service.js";

export class RssImportService {
  static async previewFeed(userId: string, feedUrl: string, podcastId?: string) {
    if (podcastId) {
      const member = await prisma.podcastMember.findUnique({
        where: { podcastId_userId: { podcastId, userId } },
      });
      if (!member) throw new Error("FORBIDDEN");

      const podcast = await prisma.podcast.findUnique({ where: { id: podcastId } });
      if (!podcast) throw new Error("PODCAST_NOT_FOUND");

      const creatorProfile = await prisma.creatorProfile.findUnique({ where: { userId } });
      const canImport = await MarketAccessService.canImportRss(podcast.countryId, creatorProfile?.id);
      if (!canImport) {
        throw new Error("MARKET_RSS_IMPORT_DISABLED");
      }
    }

    const validatedUrl = await SsrfProtectionService.validateUrl(feedUrl);
    const { text } = await SsrfProtectionService.safeFetch(validatedUrl);
    const parsed = RssParserService.parseXml(text);

    return {
      podcastId: podcastId || null,
      feedUrl: validatedUrl,
      title: parsed.title,
      description: parsed.description,
      image: parsed.image,
      author: parsed.author,
      language: parsed.language,
      website: parsed.website,
      episodeCount: parsed.items.length,
      itemCount: parsed.items.length,
      sampleEpisodes: parsed.items.slice(0, 10),
      items: parsed.items.slice(0, 50),
    };
  }

  static async connectFeed(
    userId: string,
    podcastId: string,
    feedUrl: string,
    options?: { autoSync?: boolean; importSettings?: any; sourceAuthor?: string }
  ) {
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });
    if (!member || (member.role !== "OWNER" && member.role !== "ADMIN")) {
      throw new Error("FORBIDDEN");
    }

    const podcast = await prisma.podcast.findUnique({ where: { id: podcastId } });
    if (!podcast) throw new Error("PODCAST_NOT_FOUND");

    const creatorProfile = await prisma.creatorProfile.findUnique({ where: { userId } });
    const canImport = await MarketAccessService.canImportRss(podcast.countryId, creatorProfile?.id);
    if (!canImport) throw new Error("MARKET_RSS_IMPORT_DISABLED");

    const validatedUrl = await SsrfProtectionService.validateUrl(feedUrl);

    // Créer ou mettre à jour le flux RssFeed avec autoSync et réglages d'import
    const rssFeed = await prisma.rssFeed.upsert({
      where: { podcastId },
      update: {
        url: validatedUrl,
        syncStatus: "IDLE",
        errorMessage: null,
        syncEnabled: options?.autoSync ?? true,
        importSettings: options?.importSettings ?? undefined,
        sourceAuthor: options?.sourceAuthor ?? undefined,
      },
      create: {
        podcastId,
        url: validatedUrl,
        syncStatus: "IDLE",
        syncEnabled: options?.autoSync ?? true,
        importSettings: options?.importSettings ?? undefined,
        sourceAuthor: options?.sourceAuthor ?? undefined,
      },
    });

    // Enclencher l'importation asynchrone via JobQueueItem
    await prisma.jobQueueItem.create({
      data: {
        queueName: "rss-importer",
        jobType: "RSS_INITIAL_IMPORT",
        payload: {
          rssFeedId: rssFeed.id,
          podcastId,
          feedUrl: validatedUrl,
          importSettings: options?.importSettings,
        },
      },
    });

    return {
      rssFeedId: rssFeed.id,
      syncStatus: "RUNNING",
      message: "Flux RSS connecté. Importation placée en file d'attente.",
    };
  }

  static async togglePauseFeed(userId: string, podcastId: string) {
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });
    if (!member || (member.role !== "OWNER" && member.role !== "ADMIN")) {
      throw new Error("FORBIDDEN");
    }
    const rssFeed = await prisma.rssFeed.findUnique({ where: { podcastId } });
    if (!rssFeed) throw new Error("RSS_NOT_CONNECTED");

    const newSyncEnabled = !rssFeed.syncEnabled;
    const updated = await prisma.rssFeed.update({
      where: { podcastId },
      data: {
        syncEnabled: newSyncEnabled,
        syncStatus: newSyncEnabled ? "IDLE" : "PAUSED",
      },
    });
    return {
      syncEnabled: updated.syncEnabled,
      syncStatus: updated.syncStatus,
      message: newSyncEnabled ? "Synchronisation automatique réactivée." : "Synchronisation automatique suspendue.",
    };
  }

  static async syncFeedNow(userId: string, podcastId: string) {
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });
    if (!member) throw new Error("FORBIDDEN");

    const rssFeed = await prisma.rssFeed.findUnique({ where: { podcastId } });
    if (!rssFeed) throw new Error("RSS_NOT_CONNECTED");

    await prisma.jobQueueItem.create({
      data: {
        queueName: "rss-importer",
        jobType: "RSS_SYNC_FEED",
        payload: {
          rssFeedId: rssFeed.id,
          podcastId,
          feedUrl: rssFeed.url,
        },
      },
    });

    return { message: "Demande de synchronisation ajoutée à la file d'attente." };
  }

  static async disconnectFeed(userId: string, podcastId: string) {
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });
    if (!member || member.role !== "OWNER") throw new Error("FORBIDDEN");

    await prisma.rssFeed.deleteMany({ where: { podcastId } });
    return { message: "Flux RSS déconnecté. Les épisodes importés sont conservés sur Bamako Podcast." };
  }

  static async getFeedStatus(userId: string, podcastId: string) {
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });
    if (!member) throw new Error("FORBIDDEN");

    const rssFeed = await prisma.rssFeed.findUnique({
      where: { podcastId },
      include: {
        syncRuns: {
          orderBy: { startedAt: "desc" },
          take: 5,
        },
        _count: { select: { importedEpisodes: true } },
      },
    });
    return rssFeed;
  }
}
