import crypto from "crypto";
import { prisma } from "../../config/prisma.js";
import { SsrfProtectionService } from "../../services/ssrf-protection.service.js";
import { RssParserService, ParsedRssItem } from "../rss/rss-parser.service.js";
import { YouTubeResolverService } from "./youtube-resolver.service.js";
import { YouTubeWebSubService } from "./youtube-websub.service.js";

export interface YouTubeImportSettings {
  autoPublish: boolean;
  filterKeywords?: string[];
  excludeKeywords?: string[];
  minDurationSeconds?: number;
  importScope: "ALL" | "LAST_10" | "SELECT";
  keepManualEdits: boolean;
}

export class YouTubeChannelService {
  /**
   * Résout une chaîne YouTube et prévisualise ses vidéos récentes disponibles dans le flux Atom.
   */
  static async previewChannel(rawInput: string, podcastId?: string) {
    const resolved = await YouTubeResolverService.resolveChannel(rawInput);
    
    // Récupérer le flux Atom de la chaîne
    const feedRes = await SsrfProtectionService.safeFetch(resolved.feedUrl);
    const parsed = RssParserService.parseXml(feedRes.text);

    // Vérifier les vidéos déjà importées dans Bamako Podcast
    const videoIds = parsed.items.map((i) => i.youtubeVideoId).filter(Boolean) as string[];
    const alreadyImported = await prisma.youtubeImportedVideo.findMany({
      where: { videoId: { in: videoIds } },
      select: { videoId: true, localEpisodeId: true },
    });
    const importedMap = new Map(alreadyImported.map((a) => [a.videoId, a.localEpisodeId]));

    // Enrichissement par API officielle si la clé serveur est configurée
    const apiKey = process.env.YOUTUBE_API_KEY;
    const enrichedDurations = new Map<string, { durationSeconds: number; embeddable: boolean }>();

    if (apiKey && videoIds.length > 0) {
      try {
        const idsParam = videoIds.slice(0, 50).join(",");
        const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,status&id=${idsParam}&key=${apiKey}`;
        const apiRes = await fetch(apiUrl);
        if (apiRes.ok) {
          const apiData = await apiRes.json();
          for (const item of apiData.items || []) {
            const sec = this.parseIsoDuration(item.contentDetails?.duration);
            const embeddable = item.status?.embeddable !== false;
            enrichedDurations.set(item.id, { durationSeconds: sec, embeddable });
          }
        }
      } catch {
        // En cas d'erreur de quota ou réseau, on continue avec les données du flux
      }
    }

    const videos = parsed.items.map((item) => {
      const vid = item.youtubeVideoId || "";
      const enriched = enrichedDurations.get(vid);
      const isAlready = importedMap.has(vid);

      // Détection des Shorts : indication basée sur le lien ou format court si durée connue
      const isLikelyShort = item.enclosureUrl.includes("/shorts/") || (enriched ? enriched.durationSeconds <= 60 : false);

      return {
        videoId: vid,
        title: item.title,
        description: item.description ? item.description.slice(0, 300) : "",
        publishedAt: item.pubDate,
        thumbnailUrl: item.thumbnailUrl,
        canonicalUrl: item.enclosureUrl,
        durationSeconds: enriched ? enriched.durationSeconds : (item.durationKnown ? item.durationSeconds : null),
        durationLabel: enriched 
          ? this.formatDuration(enriched.durationSeconds) 
          : (item.durationKnown ? this.formatDuration(item.durationSeconds) : "Durée inconnue"),
        isLikelyShort,
        embeddable: enriched ? enriched.embeddable : true,
        alreadyImported: isAlready,
        localEpisodeId: importedMap.get(vid) || null,
      };
    });

    return {
      channel: resolved,
      hasApiKey: !!apiKey,
      videosCount: videos.length,
      videos,
      note: apiKey 
        ? "Durées et intégrations vérifiées via YouTube Data API v3." 
        : "Durées indisponibles dans le flux standard sans clé d'API. L'aperçu affiche les vidéos récentes prêtes à l'intégration.",
    };
  }

  /**
   * Connecte une chaîne YouTube à une émission existante ou nouvelle.
   */
  static async connectChannel(
    userId: string,
    podcastId: string,
    payload: {
      channelId: string;
      channelTitle: string;
      channelDescription?: string;
      channelHandle?: string;
      thumbnailUrl?: string;
      customUrl?: string;
      uploadsPlaylistId?: string;
      feedUrl: string;
      selectedVideoIds?: string[];
      settings?: Partial<YouTubeImportSettings>;
    }
  ) {
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });
    if (!member || (member.role !== "OWNER" && member.role !== "ADMIN")) {
      throw new Error("FORBIDDEN: Vous n'avez pas les droits nécessaires sur cette émission.");
    }

    const podcast = await prisma.podcast.findUnique({ where: { id: podcastId } });
    if (!podcast) throw new Error("PODCAST_NOT_FOUND: Émission introuvable.");

    const webSubSecret = crypto.randomBytes(24).toString("hex");

    const defaultSettings: YouTubeImportSettings = {
      autoPublish: false, // Brouillon par défaut par sécurité
      importScope: payload.selectedVideoIds && payload.selectedVideoIds.length > 0 ? "SELECT" : "ALL",
      keepManualEdits: true,
      filterKeywords: [],
      excludeKeywords: [],
    };

    const importSettings = { ...defaultSettings, ...(payload.settings || {}) };

    const channelSync = await prisma.youtubeChannelSync.upsert({
      where: { podcastId },
      update: {
        channelId: payload.channelId,
        channelTitle: payload.channelTitle,
        channelDescription: payload.channelDescription || null,
        channelHandle: payload.channelHandle || null,
        thumbnailUrl: payload.thumbnailUrl || null,
        customUrl: payload.customUrl || null,
        uploadsPlaylistId: payload.uploadsPlaylistId || `UU${payload.channelId.slice(2)}`,
        feedUrl: payload.feedUrl,
        syncEnabled: true,
        syncStatus: "IDLE",
        errorMessage: null,
        importSettings: importSettings as any,
        webSubSecret,
      },
      create: {
        podcastId,
        channelId: payload.channelId,
        channelTitle: payload.channelTitle,
        channelDescription: payload.channelDescription || null,
        channelHandle: payload.channelHandle || null,
        thumbnailUrl: payload.thumbnailUrl || null,
        customUrl: payload.customUrl || null,
        uploadsPlaylistId: payload.uploadsPlaylistId || `UU${payload.channelId.slice(2)}`,
        feedUrl: payload.feedUrl,
        syncEnabled: true,
        syncStatus: "IDLE",
        importSettings: importSettings as any,
        webSubSecret,
      },
    });

    // Enclencher l'abonnement WebSub en tâche de fond
    void YouTubeWebSubService.subscribe(payload.channelId, webSubSecret).then(async (res) => {
      await prisma.youtubeChannelSync.update({
        where: { id: channelSync.id },
        data: { webSubStatus: res.success ? "ACTIVE" : "FAILED" },
      });
    });

    // Ajouter la tâche d'importation initiale à la file d'attente JobQueueItem
    await prisma.jobQueueItem.create({
      data: {
        queueName: "youtube-importer",
        jobType: "YOUTUBE_INITIAL_IMPORT",
        payload: {
          youtubeChannelSyncId: channelSync.id,
          podcastId,
          selectedVideoIds: payload.selectedVideoIds,
        },
        status: "PENDING",
      },
    });

    return {
      channelSyncId: channelSync.id,
      syncStatus: "RUNNING",
      message: "Chaîne YouTube connectée. L'importation des vidéos est en cours d'exécution en arrière-plan.",
    };
  }

  /**
   * Déclenche une synchronisation immédiate de la chaîne.
   */
  static async syncChannelNow(userId: string, podcastId: string) {
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });
    if (!member) throw new Error("FORBIDDEN");

    const channel = await prisma.youtubeChannelSync.findUnique({ where: { podcastId } });
    if (!channel) throw new Error("YOUTUBE_NOT_CONNECTED: Aucune chaîne YouTube n'est liée à cette émission.");

    await prisma.jobQueueItem.create({
      data: {
        queueName: "youtube-importer",
        jobType: "YOUTUBE_SYNC_FEED",
        payload: {
          youtubeChannelSyncId: channel.id,
          podcastId,
        },
        status: "PENDING",
      },
    });

    return { message: "Synchronisation de la chaîne YouTube mise en file d'attente." };
  }

  /**
   * Met à jour les réglages de synchronisation ou suspend/reprend l'automatisation.
   */
  static async updateSettings(
    userId: string,
    podcastId: string,
    data: { syncEnabled?: boolean; settings?: Partial<YouTubeImportSettings> }
  ) {
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });
    if (!member || (member.role !== "OWNER" && member.role !== "ADMIN")) {
      throw new Error("FORBIDDEN");
    }

    const channel = await prisma.youtubeChannelSync.findUnique({ where: { podcastId } });
    if (!channel) throw new Error("YOUTUBE_NOT_CONNECTED");

    const currentSettings = (channel.importSettings as any) || {};
    const updatedSettings = data.settings ? { ...currentSettings, ...data.settings } : currentSettings;

    const updated = await prisma.youtubeChannelSync.update({
      where: { podcastId },
      data: {
        syncEnabled: data.syncEnabled !== undefined ? data.syncEnabled : channel.syncEnabled,
        importSettings: updatedSettings,
        syncStatus: data.syncEnabled === false ? "PAUSED" : (channel.syncStatus === "PAUSED" ? "IDLE" : channel.syncStatus),
      },
    });

    return updated;
  }

  /**
   * Déconnecte la chaîne YouTube en désabonnant WebSub et en conservant les épisodes par défaut.
   */
  static async disconnectChannel(userId: string, podcastId: string, deleteEpisodes = false) {
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });
    if (!member || member.role !== "OWNER") throw new Error("FORBIDDEN: Seul le propriétaire peut déconnecter la chaîne.");

    const channel = await prisma.youtubeChannelSync.findUnique({ where: { podcastId } });
    if (!channel) throw new Error("YOUTUBE_NOT_CONNECTED");

    // Désabonnement WebSub
    if (channel.webSubSecret) {
      void YouTubeWebSubService.unsubscribe(channel.channelId, channel.webSubSecret);
    }

    if (deleteEpisodes) {
      // Suppression explicite demandée par l'utilisateur
      const imported = await prisma.youtubeImportedVideo.findMany({
        where: { youtubeChannelId: channel.id, localEpisodeId: { not: null } },
        select: { localEpisodeId: true },
      });
      const epIds = imported.map((i) => i.localEpisodeId as string);
      if (epIds.length > 0) {
        await prisma.episode.deleteMany({ where: { id: { in: epIds } } });
      }
    }

    await prisma.youtubeChannelSync.delete({ where: { podcastId } });

    return {
      message: deleteEpisodes
        ? "Chaîne YouTube déconnectée et épisodes associés supprimés."
        : "Chaîne YouTube déconnectée. Tous les épisodes déjà importés sont conservés sur Bamako Podcast.",
    };
  }

  /**
   * Retourne l'état complet et l'historique des synchronisations de la chaîne.
   */
  static async getChannelStatus(userId: string, podcastId: string) {
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });
    if (!member) throw new Error("FORBIDDEN");

    const channel = await prisma.youtubeChannelSync.findUnique({
      where: { podcastId },
      include: {
        syncRuns: {
          orderBy: { startedAt: "desc" },
          take: 10,
        },
        _count: {
          select: { importedVideos: true },
        },
      },
    });

    if (!channel) return null;

    // Statistiques cumulées réelles
    const stats = await prisma.youtubeImportedVideo.groupBy({
      by: ["status"],
      where: { youtubeChannelId: channel.id },
      _count: { id: true },
    });

    const statusCounts: Record<string, number> = {};
    for (const s of stats) {
      statusCounts[s.status] = s._count.id;
    }

    return {
      channel,
      counts: {
        totalDiscovered: channel._count.importedVideos,
        imported: statusCounts["IMPORTED"] || 0,
        skipped: statusCounts["SKIPPED"] || 0,
        excluded: statusCounts["EXCLUDED"] || 0,
      },
    };
  }

  /**
   * Importation historique des anciennes vidéos par pagination de l'API YouTube Data v3.
   */
  static async historicalImport(
    userId: string,
    podcastId: string,
    options: { pageToken?: string; selectedVideoIds?: string[]; autoPublish?: boolean }
  ) {
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });
    if (!member || (member.role !== "OWNER" && member.role !== "ADMIN")) {
      throw new Error("FORBIDDEN");
    }

    const channel = await prisma.youtubeChannelSync.findUnique({ where: { podcastId } });
    if (!channel) throw new Error("YOUTUBE_NOT_CONNECTED");

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "YOUTUBE_API_KEY_REQUIRED: La clé d'API YouTube Data v3 n'est pas configurée sur le serveur. L'importation de l'historique complet nécessite une clé d'API officielle. Vous pouvez importer les 15 vidéos récentes disponibles dans le flux public ou coller des URLs individuelles."
      );
    }

    const playlistId = channel.uploadsPlaylistId || `UU${channel.channelId.slice(2)}`;
    let url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=25&key=${apiKey}`;
    if (options.pageToken) {
      url += `&pageToken=${encodeURIComponent(options.pageToken)}`;
    }

    const res = await fetch(url);
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`YOUTUBE_API_ERROR: Erreur YouTube Data API (${res.status}): ${errBody.slice(0, 200)}`);
    }

    const data = await res.json();
    const items = data.items || [];
    const videoIds = items.map((i: any) => i.contentDetails?.videoId).filter(Boolean);

    // Récupérer durées réelles ISO 8601
    const enriched = new Map<string, number>();
    if (videoIds.length > 0) {
      try {
        const vUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds.join(",")}&key=${apiKey}`;
        const vRes = await fetch(vUrl);
        if (vRes.ok) {
          const vData = await vRes.json();
          for (const vi of vData.items || []) {
            enriched.set(vi.id, this.parseIsoDuration(vi.contentDetails?.duration));
          }
        }
      } catch {}
    }

    // Vérifier les déjà importés
    const already = await prisma.youtubeImportedVideo.findMany({
      where: { videoId: { in: videoIds } },
      select: { videoId: true },
    });
    const alreadySet = new Set(already.map((a) => a.videoId));

    const videos = items.map((item: any) => {
      const vid = item.contentDetails?.videoId;
      const snippet = item.snippet;
      const durationSeconds = enriched.get(vid) || 0;

      return {
        videoId: vid,
        title: snippet?.title || "Vidéo sans titre",
        description: snippet?.description || "",
        publishedAt: snippet?.publishedAt ? new Date(snippet.publishedAt) : null,
        thumbnailUrl: snippet?.thumbnails?.high?.url || snippet?.thumbnails?.default?.url,
        durationSeconds: durationSeconds > 0 ? durationSeconds : null,
        durationLabel: durationSeconds > 0 ? this.formatDuration(durationSeconds) : "Durée inconnue",
        alreadyImported: alreadySet.has(vid),
      };
    });

    return {
      videos,
      nextPageToken: data.nextPageToken || null,
      prevPageToken: data.prevPageToken || null,
      totalResults: data.pageInfo?.totalResults || 0,
    };
  }

  /**
   * Analyse une durée ISO 8601 (ex: PT1H15M33S) en secondes.
   */
  private static parseIsoDuration(isoDuration: string): number {
    if (!isoDuration) return 0;
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    const hours = parseInt(match[1] || "0", 10);
    const minutes = parseInt(match[2] || "0", 10);
    const seconds = parseInt(match[3] || "0", 10);
    return hours * 3600 + minutes * 60 + seconds;
  }

  private static formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return "Durée inconnue";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}h ${m.toString().padStart(2, "0")}m`;
    }
    return `${m}m ${s.toString().padStart(2, "0")}s`;
  }
}
