import { Request, Response } from "express";
import { RssParserService } from "../rss/rss-parser.service.js";
import { RssImportService } from "../rss/rss-import.service.js";
import { prisma } from "../../config/prisma.js";

const sendSuccess = (res: Response, data: any, meta: any = null, code = 200) => res.status(code).json({ success: true, data, meta });
const sendError = (res: Response, message: string, code = 400) => res.status(code).json({ success: false, error: message });

export class AdminRssController {
  
  static async previewRss(req: Request, res: Response) {
    try {
      const { url } = req.body;
      if (!url) return sendError(res, "L'URL du flux RSS est requise.");

      // Verify if already mapped
      const existingRss = await prisma.rssFeed.findFirst({
        where: { url },
        include: { podcast: true }
      });

      // Fetch the XML
      const response = await fetch(url);
      if (!response.ok) return sendError(res, `Impossible de récupérer le flux (HTTP ${response.status})`);
      
      const xmlText = await response.text();
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
      // Create a Draft Podcast and associate it with RSS, then spawn an import.
      // Since RSS import can take time, return 202 Accepted.
      const { url, name, description, cover, languageCode, categoryIds, countryId, city, creatorName, syncEnabled } = req.body;

      if (!url || !name) return sendError(res, "L'URL et le nom sont requis.");

      // In a real scenario, this would use AdminCatalogService to create the Podcast, 
      // then RssImportService to queue the import. We'll simulate creating the Podcast and RSS Feed record.
      
      const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const slug = `${slugBase}-${Date.now()}`;

      const podcast = await prisma.podcast.create({
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
          managedByBamakoPodcast: false, // It's from RSS
          categories: categoryIds && categoryIds.length > 0 ? {
            create: categoryIds.map((c: string) => ({ categoryId: c }))
          } : undefined
        }
      });

      const rssFeed = await prisma.rssFeed.create({
        data: {
          url,
          podcastId: podcast.id,
          syncStatus: "PENDING"
        }
      });

      // Simulation: Fire off background processing...
      // await RssImportService.processFeed(rssFeed.id);

      return sendSuccess(res, {
        operationId: rssFeed.id, // we can use the rssFeed ID as an operation tracker
        podcastId: podcast.id
      }, null, 202);

    } catch (e: any) {
      return sendError(res, e.message);
    }
  }

  static async getImportStatus(req: Request, res: Response) {
    try {
      const { id } = req.params; // operation ID (rssFeedId)
      const rss = await prisma.rssFeed.findUnique({
        where: { id }
      });
      if (!rss) return sendError(res, "Import introuvable", 404);

      return sendSuccess(res, {
        id: rss.id,
        status: rss.syncStatus, // PENDING, SYNCING, SUCCESS, ERROR
        lastSyncAt: rss.lastSyncAt,
        errorMessage: rss.errorMessage
      });
    } catch (e: any) {
      return sendError(res, e.message);
    }
  }
}
