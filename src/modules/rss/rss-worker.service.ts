import { PrismaClient } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { SsrfProtectionService } from "../../services/ssrf-protection.service.js";
import { RssParserService, ParsedRssItem } from "./rss-parser.service.js";
import { slugify } from "../creator/creator-profile.service.js";
import { describeRssError, isPermanentRssError } from "./rss-errors.js";
import {
  parseImportSettings,
  pickInitialGuids,
  treatmentToEpisodeStatus,
  RssImportSettings,
} from "./rss-import-settings.js";

/** Intervalle de synchronisation automatique d'un flux en bonne santé. */
export const RSS_SYNC_INTERVAL_MS = 60 * 60 * 1000;
/** Délai avant de retenter automatiquement un flux dont la dernière synchronisation a échoué. */
export const RSS_ERROR_BACKOFF_MS = 6 * 60 * 60 * 1000;
/** Délai de base entre deux tentatives d'une même tâche (multiplié par le numéro de tentative). */
export const RSS_JOB_RETRY_DELAY_MS = 30 * 1000;

const WORKER_ID = "rss-worker-1";
const PROGRESS_EVERY = 20;

export interface RssWorkerDeps {
  db: PrismaClient;
  fetchFeed: (
    url: string,
    headers: Record<string, string>
  ) => Promise<{ text: string; status: number; etag?: string; lastModified?: string }>;
  now: () => Date;
}

const defaultDeps = (): RssWorkerDeps => ({
  db: prisma,
  fetchFeed: (url, headers) => SsrfProtectionService.safeFetch(url, headers),
  now: () => new Date(),
});

type Outcome = "imported" | "updated" | "skipped";

export class RssWorkerService {
  static async scheduleAutoSyncs() {
    const feeds = await prisma.rssFeed.findMany({
      where: {
        syncEnabled: true,
        nextSyncAt: { lte: new Date() },
        syncStatus: { notIn: ['SYNCING', 'PENDING'] }
      }
    });
    for (const feed of feeds) {
      await prisma.$transaction(async (tx) => {
        await tx.jobQueueItem.create({
          data: {
            queueName: 'rss-importer',
            jobType: 'import-feed',
            payload: { rssFeedId: feed.id },
            status: 'PENDING'
          }
        });
        await tx.rssFeed.update({
          where: { id: feed.id },
          data: { syncStatus: 'PENDING', nextSyncAt: null }
        });
      });
      console.log(`[RSS Worker] Scheduled auto-sync for feed ${feed.id}`);
    }
  }


  static async processNextJob(deps: RssWorkerDeps = defaultDeps()): Promise<boolean> {
    const { db, now } = deps;

    const job = await db.$transaction(async (tx) => {
      const pending = await tx.jobQueueItem.findFirst({
        where: {
          status: "PENDING",
          queueName: "rss-importer",
          runAt: { lte: now() },
        },
        orderBy: { runAt: "asc" },
      });

      if (!pending) return null;

      // Prise de verrou atomique : si un autre worker l'a déjà prise, count vaut 0.
      const claimed = await tx.jobQueueItem.updateMany({
        where: { id: pending.id, status: "PENDING" },
        data: {
          status: "PROCESSING",
          lockedAt: now(),
          lockedBy: WORKER_ID,
          attempts: { increment: 1 },
        },
      });
      if (claimed.count !== 1) return null;

      return tx.jobQueueItem.findUnique({ where: { id: pending.id } });
    });

    if (!job) return false;

    try {
      const payload = job.payload as any;
      await this.handleRssImport(payload.rssFeedId, payload.podcastId, payload.feedUrl, deps);

      await db.jobQueueItem.update({
        where: { id: job.id },
        data: { status: "COMPLETED", lastError: null, lockedAt: null, lockedBy: null },
      });
    } catch (error: any) {
      const info = describeRssError(error);
      const raw = error?.message || "";
      // Une erreur permanente (flux invalide, adresse interdite…) ne sera pas rejouée automatiquement.
      const isFinal = isPermanentRssError(error) || job.attempts >= job.maxAttempts;
      if (info.code === "RSS_IMPORT_FAILED") console.error("[rss-worker] erreur inattendue:", error);

      await db.jobQueueItem.update({
        where: { id: job.id },
        data: {
          status: isFinal ? "FAILED" : "PENDING",
          lastError: raw && raw !== info.code ? `${info.code}: ${raw}` : info.code,
          lockedAt: null,
          lockedBy: null,
          ...(isFinal ? {} : { runAt: new Date(now().getTime() + RSS_JOB_RETRY_DELAY_MS * job.attempts) }),
        },
      });
    }

    return true;
  }

  static async handleRssImport(
    rssFeedId: string,
    podcastId?: string,
    feedUrl?: string,
    deps: RssWorkerDeps = defaultDeps()
  ) {
    const { db, now, fetchFeed } = deps;

    const rssFeed = await db.rssFeed.findUnique({ where: { id: rssFeedId } });
    if (!rssFeed) return;

    const actualPodcastId = podcastId || rssFeed.podcastId;
    const actualFeedUrl = feedUrl || rssFeed.url;

    const settings = parseImportSettings(rssFeed.importSettings);
    const nextSyncAfterSuccess = () =>
      rssFeed.syncEnabled ? new Date(now().getTime() + RSS_SYNC_INTERVAL_MS) : null;

    // Créer la session de synchronisation RssSyncRun
    const syncRun = await db.rssSyncRun.create({
      data: { rssFeedId, status: "RUNNING", startedAt: now() },
    });
    await db.rssFeed.update({
      where: { id: rssFeedId },
      data: { syncStatus: "SYNCING", errorMessage: null },
    });

    const counts = { discovered: 0, imported: 0, updated: 0, skipped: 0, failed: 0 };
    const failures: string[] = [];
    const saveCounts = (extra: Record<string, unknown> = {}) =>
      db.rssSyncRun.update({
        where: { id: syncRun.id },
        data: {
          episodesDiscovered: counts.discovered,
          episodesImported: counts.imported,
          episodesUpdated: counts.updated,
          episodesSkipped: counts.skipped,
          episodesFailed: counts.failed,
          ...extra,
        },
      });

    try {
      // Fetch avec en-têtes HTTP ETag / Last-Modified
      const headers: Record<string, string> = {};
      if (rssFeed.etag) headers["If-None-Match"] = rssFeed.etag;
      if (rssFeed.lastModified) headers["If-Modified-Since"] = rssFeed.lastModified;

      const fetchResult = await fetchFeed(actualFeedUrl, headers);

      // Si 304 Not Modified, pas de modification
      if (fetchResult.status === 304) {
        await saveCounts({ status: "SUCCESS", completedAt: now() });
        await db.rssFeed.update({
          where: { id: rssFeedId },
          data: {
            lastSyncAt: now(),
            nextSyncAt: nextSyncAfterSuccess(),
            syncStatus: "IDLE",
            errorMessage: null,
          },
        });
        return;
      }

      const parsed = RssParserService.parseXml(fetchResult.text);
      counts.discovered = parsed.items.length;
      await saveCounts();

      // Import initial restreint (10 derniers / sélection) : les épisodes écartés sont mémorisés comme
      // « ignorés » (sans épisode local) pour ne jamais être importés par une synchronisation ultérieure.
      const alreadyKnown = await db.rssImportedEpisode.count({ where: { rssFeedId } });
      if (alreadyKnown === 0 && settings.importScope !== "ALL") {
        const keep = pickInitialGuids(parsed.items, settings);
        const excluded = parsed.items.filter((i) => !keep.has(i.guid));
        if (excluded.length > 0) {
          await db.rssImportedEpisode.createMany({
            data: excluded.map((i) => ({
              rssFeedId,
              guid: i.guid,
              enclosureUrl: i.enclosureUrl,
              enclosureType: i.enclosureType,
              enclosureLength: i.enclosureLength ? BigInt(i.enclosureLength) : null,
              sourcePublishedAt: i.pubDate,
              sourceHash: i.fingerprint,
              localEpisodeId: null,
            })),
            skipDuplicates: true,
          });
        }
      }

      const seenGuids = new Set<string>();
      let processed = 0;
      for (const item of parsed.items) {
        processed++;
        if (seenGuids.has(item.guid)) {
          counts.skipped++; // GUID dupliqué dans le même flux
        } else {
          seenGuids.add(item.guid);
          try {
            const outcome = await this.processItem(db, now, rssFeedId, actualPodcastId, item, settings);
            counts[outcome]++;
          } catch (itemError: any) {
            counts.failed++;
            if (failures.length < 3) failures.push(`${item.title} : ${itemError?.message || "erreur inconnue"}`);
          }
        }
        if (processed % PROGRESS_EVERY === 0) await saveCounts();
      }

      if (counts.failed > 0 && counts.imported + counts.updated + counts.skipped === 0) {
        throw new Error("RSS_ALL_EPISODES_FAILED");
      }

      // Mettre à jour RssSyncRun & RssFeed
      await saveCounts({
        status: "SUCCESS",
        completedAt: now(),
        errorMessage:
          counts.failed > 0
            ? `${counts.failed} épisode(s) n'ont pas pu être importés. Exemple : ${failures[0]}`
            : null,
      });

      await db.rssFeed.update({
        where: { id: rssFeedId },
        data: {
          etag: fetchResult.etag,
          lastModified: fetchResult.lastModified,
          lastSyncAt: now(),
          lastSuccessfulSyncAt: now(),
          nextSyncAt: nextSyncAfterSuccess(),
          syncStatus: "IDLE",
          errorMessage: null,
          ...(parsed.author ? { sourceAuthor: parsed.author } : {}),
        },
      });
    } catch (error: any) {
      const info = describeRssError(error);
      await saveCounts({ status: "FAILED", completedAt: now(), errorMessage: info.message });

      await db.rssFeed.update({
        where: { id: rssFeedId },
        data: {
          syncStatus: "ERROR",
          errorMessage: info.message,
          lastSyncAt: now(),
          nextSyncAt: rssFeed.syncEnabled ? new Date(now().getTime() + RSS_ERROR_BACKOFF_MS) : null,
        },
      });

      throw error;
    }
  }

  private static async processItem(
    db: PrismaClient,
    now: () => Date,
    rssFeedId: string,
    podcastId: string,
    item: ParsedRssItem,
    settings: RssImportSettings
  ): Promise<Outcome> {
    // L'adresse audio distante est lue telle quelle par les lecteurs : seul http(s) est accepté.
    if (!/^https?:\/\//i.test(item.enclosureUrl)) {
      throw new Error("adresse audio invalide (http ou https attendu)");
    }

    // 1. Recherche de correspondance existante par GUID
    const existing = await db.rssImportedEpisode.findUnique({
      where: { rssFeedId_guid: { rssFeedId, guid: item.guid } },
      include: { localEpisode: true },
    });

    if (existing) {
      // Écarté lors de l'import initial, ou épisode local supprimé depuis : on ne le recrée pas.
      if (!existing.localEpisodeId || !existing.localEpisode) return "skipped";

      let changed = false;

      // Si l'épisode a été modifié manuellement sur Bamako Podcast, préserver ses champs (selon le réglage)
      const protectedByManualEdit = settings.keepManualEdits && existing.localEpisode.isManuallyEdited;
      if (!protectedByManualEdit && existing.sourceHash !== item.fingerprint) {
        await db.episode.update({
          where: { id: existing.localEpisodeId },
          data: {
            title: item.title,
            description: item.description,
            durationSeconds: item.durationSeconds,
          },
        });
        await db.rssImportedEpisode.update({
          where: { id: existing.id },
          data: { sourceHash: item.fingerprint, sourcePublishedAt: item.pubDate },
        });
        changed = true;
      }

      // Adresse audio déplacée par l'hébergeur : on suit le flux (sans toucher aux sources remplacées à la main).
      if (existing.enclosureUrl !== item.enclosureUrl) {
        await db.mediaSource.updateMany({
          where: {
            episodeId: existing.localEpisodeId,
            sourceType: "RSS_FEED",
            externalUrl: existing.enclosureUrl,
          },
          data: { externalUrl: item.enclosureUrl, mimeType: item.enclosureType },
        });
        await db.rssImportedEpisode.update({
          where: { id: existing.id },
          data: { enclosureUrl: item.enclosureUrl, enclosureType: item.enclosureType },
        });
        changed = true;
      }

      return changed ? "updated" : "skipped";
    }

    // 2. Déduplication alternative : slug d'épisode
    const slugBase = slugify(item.title) || "episode";
    let slug = slugBase;
    let c = 1;
    while (await db.episode.findUnique({ where: { podcastId_slug: { podcastId, slug } } })) {
      c++;
      slug = `${slugBase}-${c}`;
    }

    // 3. Création atomique de l'épisode, de sa source média (adresse distante conservée, aucun fichier
    //    copié) et de la liaison RssImportedEpisode : pas d'épisode orphelin si une étape échoue.
    await db.$transaction(async (tx) => {
      const episode = await tx.episode.create({
        data: {
          podcastId,
          title: item.title,
          slug,
          description: item.description,
          durationSeconds: item.durationSeconds,
          publishedAt: item.pubDate || now(),
          status: treatmentToEpisodeStatus(settings.newEpisodesTreatment),
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

      await tx.rssImportedEpisode.create({
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
    });

    return "imported";
  }
}
