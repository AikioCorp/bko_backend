import { prisma } from "../../config/prisma.js";
import { SsrfProtectionService } from "../../services/ssrf-protection.service.js";
import { RssParserService } from "./rss-parser.service.js";
import { slugify } from "../creator/creator-profile.service.js";

export class RssWorkerService {
  static async processNextJob(): Promise<boolean> {
    const job = await prisma.$transaction(async (tx) => {
      const pending = await tx.jobQueueItem.findFirst({
        where: {
          status: "PENDING",
          queueName: "rss-importer",
          runAt: { lte: new Date() },
        },
        orderBy: { runAt: "asc" },
      });

      if (!pending) return null;

      return tx.jobQueueItem.update({
        where: { id: pending.id },
        data: {
          status: "PROCESSING",
          lockedAt: new Date(),
          lockedBy: "rss-worker-1",
          attempts: { increment: 1 },
        },
      });
    });

    if (!job) return false;

    try {
      const payload = job.payload as any;
      await this.handleRssImport(payload.rssFeedId, payload.podcastId, payload.feedUrl);

      await prisma.jobQueueItem.update({
        where: { id: job.id },
        data: { status: "COMPLETED" },
      });
    } catch (error: any) {
      await prisma.jobQueueItem.update({
        where: { id: job.id },
        data: {
          status: job.attempts >= job.maxAttempts ? "FAILED" : "PENDING",
          lastError: error.message || "Erreur d'importation RSS",
        },
      });
    }

    return true;
  }

  private static async handleRssImport(rssFeedId: string, podcastId: string, feedUrl: string) {
    const rssFeed = await prisma.rssFeed.findUnique({ where: { id: rssFeedId } });
    if (!rssFeed) return;

    // Créer la session de synchronisation RssSyncRun
    const syncRun = await prisma.rssSyncRun.create({
      data: {
        rssFeedId,
        status: "RUNNING",
      },
    });

    try {
      // Fetch avec en-têtes HTTP ETag / Last-Modified
      const headers: Record<string, string> = {};
      if (rssFeed.etag) headers["If-None-Match"] = rssFeed.etag;
      if (rssFeed.lastModified) headers["If-Modified-Since"] = rssFeed.lastModified;

      const fetchResult = await SsrfProtectionService.safeFetch(feedUrl, headers);

      // Si 304 Not Modified, pas de modification
      if (fetchResult.status === 304) {
        await prisma.rssSyncRun.update({
          where: { id: syncRun.id },
          data: {
            status: "SUCCESS",
            completedAt: new Date(),
          },
        });
        await prisma.rssFeed.update({
          where: { id: rssFeedId },
          data: {
            lastSyncAt: new Date(),
            nextSyncAt: new Date(Date.now() + 60 * 60 * 1000), // Prochaine sync dans 1h
          },
        });
        return;
      }

      const parsed = RssParserService.parseXml(fetchResult.text);

      let importedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (const item of parsed.items) {
        // 1. Recherche de correspondance existante par GUID ou Enclosure
        const existingImported = await prisma.rssImportedEpisode.findUnique({
          where: { rssFeedId_guid: { rssFeedId, guid: item.guid } },
          include: { localEpisode: true },
        });

        if (existingImported) {
          // Si l'épisode a été modifié manuellement sur Bamako Podcast, préserver les champs manuels
          if (existingImported.localEpisode?.isManuallyEdited) {
            skippedCount++;
            continue;
          }

          // Mise à jour de l'épisode si le hash de source a changé
          if (existingImported.sourceHash !== item.fingerprint) {
            await prisma.episode.update({
              where: { id: existingImported.localEpisodeId! },
              data: {
                title: item.title,
                description: item.description,
                durationSeconds: item.durationSeconds,
              },
            });
            await prisma.rssImportedEpisode.update({
              where: { id: existingImported.id },
              data: { sourceHash: item.fingerprint, sourcePublishedAt: item.pubDate },
            });
            updatedCount++;
          } else {
            skippedCount++;
          }
          continue;
        }

        // 2. Déduplication alternative : slug d'épisode
        let slugBase = slugify(item.title);
        let slug = slugBase;
        let c = 1;
        while (await prisma.episode.findUnique({ where: { podcastId_slug: { podcastId, slug } } })) {
          c++;
          slug = `${slugBase}-${c}`;
        }

        // 3. Création du nouvel Épisode & MediaSource (Source externe conservée sur le serveur RSS)
        const episode = await prisma.episode.create({
          data: {
            podcastId,
            title: item.title,
            slug,
            description: item.description,
            durationSeconds: item.durationSeconds,
            publishedAt: item.pubDate || new Date(),
            status: "PUBLISHED",
            creationSource: "RSS_IMPORT",
            isManuallyEdited: false,
            mediaSources: {
              create: {
                type: item.mediaType,
                sourceType: "RSS_FEED",
                playbackMode: "NATIVE",
                externalUrl: item.enclosureUrl,
                durationSeconds: item.durationSeconds,
                mimeType: item.enclosureType,
                isPrimaryAudio: item.mediaType === "AUDIO",
                isPrimaryVideo: item.mediaType === "VIDEO",
              },
            },
          },
        });

        // 4. Enregistrer la liaison dans RssImportedEpisode
        await prisma.rssImportedEpisode.create({
          data: {
            rssFeedId,
            guid: item.guid,
            enclosureUrl: item.enclosureUrl,
            enclosureType: item.enclosureType,
            enclosureLength: item.enclosureLength ? BigInt(item.enclosureLength) : null,
            sourcePublishedAt: item.pubDate,
            sourceHash: item.fingerprint,
            localEpisodeId: episode.id,
          },
        });

        importedCount++;
      }

      // Mettre à jour RssSyncRun & RssFeed
      await prisma.rssSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "SUCCESS",
          completedAt: new Date(),
          episodesDiscovered: parsed.items.length,
          episodesImported: importedCount,
          episodesUpdated: updatedCount,
          episodesSkipped: skippedCount,
        },
      });

      await prisma.rssFeed.update({
        where: { id: rssFeedId },
        data: {
          etag: fetchResult.etag,
          lastModified: fetchResult.lastModified,
          lastSyncAt: new Date(),
          lastSuccessfulSyncAt: new Date(),
          nextSyncAt: new Date(Date.now() + 60 * 60 * 1000), // Prochaine sync 1h
          syncStatus: "IDLE",
          errorMessage: null,
        },
      });
    } catch (error: any) {
      await prisma.rssSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          errorMessage: error.message || "Échec d'importation RSS",
        },
      });

      await prisma.rssFeed.update({
        where: { id: rssFeedId },
        data: {
          syncStatus: "ERROR",
          errorMessage: error.message || "Erreur d'importation RSS",
        },
      });

      throw error;
    }
  }
}
