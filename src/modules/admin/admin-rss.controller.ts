import { Request, Response } from "express";
import { RssParserService } from "../rss/rss-parser.service.js";
import { RssUrlService } from "../rss/rss-url.service.js";
import { prisma } from "../../config/prisma.js";
import { parseImportSettings } from "../rss/rss-import-settings.js";
import { SsrfProtectionService } from "../../services/ssrf-protection.service.js";

const sendSuccess = (res: Response, data: any, meta: any = null, code = 200) => res.status(code).json({ success: true, data, meta });
const sendError = (res: Response, message: string, code = 400) => res.status(code).json({ success: false, error: message });

export class AdminRssController {
  
  static async previewRss(req: Request, res: Response) {
    try {
      const { url } = req.body;
      if (!url) return sendError(res, "L'URL du flux RSS est requise.");

      const normalizedUrl = RssUrlService.normalize(url);

      // Verify if already mapped
      const existingRss = await prisma.rssFeed.findFirst({
        where: { url: normalizedUrl },
        include: { podcast: true }
      });

      // SSRF validation and safe fetching
      const fetchResult = await SsrfProtectionService.safeFetch(normalizedUrl);
      if (fetchResult.status !== 200) throw new Error(`HTTP ${fetchResult.status}`);
      const xmlText = fetchResult.text;
      const parsed = RssParserService.parseXml(xmlText);

      return sendSuccess(res, {
        preview: {
          title: parsed.title,
          description: parsed.description,
          image: parsed.image,
          author: parsed.author,
          language: parsed.language,
          episodesCount: parsed.items.length,
          sampleEpisodes: parsed.items.slice(0, 3).map(i => ({
            title: i.title,
            durationSeconds: i.durationSeconds,
            pubDate: i.pubDate
          }))
        },
        existingPodcast: existingRss?.podcast ? {
          id: existingRss.podcast.id,
          name: existingRss.podcast.name
        } : null
      });

    } catch (e: any) {
      return sendError(res, "Erreur lors de l'analyse du flux: " + e.message);
    }
  }

  static async createImport(req: Request, res: Response) {
    try {
      const { url, name, description, cover, languageCode, categoryIds, countryId, city, creatorName, syncEnabled, importSettings, sourceAuthor } = req.body;

      if (!url || !name) return sendError(res, "L'URL et le nom sont requis.");

      const normalizedUrl = RssUrlService.normalize(url);

      // check if it exists
      const existingRss = await prisma.rssFeed.findFirst({ where: { url: normalizedUrl } });
      if (existingRss) {
         return sendError(res, "Un flux avec cette URL existe déjà.");
      }

      const settings = parseImportSettings(importSettings);
      
      const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const slug = `${slugBase}-${Date.now()}`;

      // Transaction atomique pour garantir que l'import est complètement initialisé
      const { podcast, rssFeed } = await prisma.$transaction(async (tx) => {
        // 1. Create podcast
        const p = await tx.podcast.create({
          data: {
            name,
            slug,
            description: description || "",
            cover: cover || "",
            primaryLanguageCode: languageCode || "fr",
            countryId: countryId || "ML",
            city,
            status: "DRAFT",
            creationSource: "ADMIN",
            ownershipStatus: "UNCLAIMED",
            managedByBamakoPodcast: false,
            categories: categoryIds && categoryIds.length > 0 ? {
              create: categoryIds.map((c: string) => ({ categoryId: c }))
            } : undefined
          }
        });

        // 2. Create RSS Feed
        const r = await tx.rssFeed.create({
          data: {
            url: normalizedUrl,
            podcastId: p.id,
            syncStatus: "PENDING",
            syncEnabled: syncEnabled !== false, // default true
            sourceAuthor: sourceAuthor || creatorName || null,
            importSettings: settings as any // cast for Prisma Json
          }
        });

        // 3. Queue the import job
        await tx.jobQueueItem.create({
          data: {
            queueName: "rss-importer",
            jobType: "import-feed",
            payload: { rssFeedId: r.id },
            status: "PENDING",
          }
        });

        return { podcast: p, rssFeed: r };
      });

      return sendSuccess(res, {
        operationId: rssFeed.id,
        podcastId: podcast.id
      }, null, 202);

    } catch (e: any) {
      return sendError(res, e.message);
    }
  }

  static async getImportStatus(req: Request, res: Response) {
    try {
      const { id } = req.params; 
      const rss = await prisma.rssFeed.findUnique({
        where: { id }
      });
      if (!rss) return sendError(res, "Import introuvable", 404);

      // Get the latest run for this feed
      const run = await prisma.rssSyncRun.findFirst({
        where: { rssFeedId: rss.id },
        orderBy: { startedAt: 'desc' }
      });

      return sendSuccess(res, {
        id: rss.id,
        status: rss.syncStatus, // PENDING, SYNCING, SUCCESS, ERROR
        lastSyncAt: rss.lastSyncAt,
        errorMessage: rss.errorMessage,
        metrics: run ? {
          episodesDiscovered: run.episodesDiscovered,
          episodesImported: run.episodesImported,
          episodesUpdated: run.episodesUpdated,
          episodesSkipped: run.episodesSkipped,
          episodesFailed: run.episodesFailed,
        } : null
      });
    } catch (e: any) {
      return sendError(res, e.message);
    }
  }

  static async syncFeedNow(req: Request, res: Response) {
    try {
      const { id } = req.params;
      
      const podcast = await prisma.podcast.findUnique({
        where: { id },
        include: { rssFeed: true }
      });
      
      if (!podcast) return sendError(res, "Podcast introuvable", 404);
      
      const rssFeed = podcast.rssFeed;
      if (!rssFeed) return sendError(res, "RSS non connecté", 400);

      await prisma.jobQueueItem.create({
        data: {
          queueName: "rss-importer",
          jobType: "RSS_SYNC_FEED",
          payload: {
            rssFeedId: rssFeed.id,
            podcastId: id,
            feedUrl: rssFeed.url,
          },
        },
      });

      return sendSuccess(res, { message: "Synchronisation lancée" });
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

}