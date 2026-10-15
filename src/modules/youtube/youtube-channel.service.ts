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
  excludeShorts?: boolean;
  minDurationSeconds?: number;
  importScope: "ALL" | "LAST_10" | "SELECT";
  keepManualEdits: boolean;
}

export class YouTubeChannelService {
  /**
   * Récupère la liste des vidéos régulières de la chaîne depuis l'onglet /videos de YouTube.
   * Cet onglet exclut nativement les Shorts et fournit les vrais épisodes longs.
   */
  static async fetchChannelVideosTab(channelId: string, customUrl?: string): Promise<Array<{
    videoId: string;
    title: string;
    thumbnailUrl: string;
    durationLabel?: string;
    publishedAt?: Date | null;
  }>> {
    const targetUrl = customUrl ? `${customUrl.replace(/\/+$/, "")}/videos` : `https://www.youtube.com/channel/${channelId}/videos`;
    try {
      const res = await SsrfProtectionService.safeFetch(targetUrl, {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      });

      const html = res.text;
      const match = html.match(/var ytInitialData = ({.*?});<\/script>/s) || html.match(/ytInitialData\s*=\s*({.+?});/s);
      if (!match) return [];

      const data = JSON.parse(match[1]);
      const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
      const videosTab = tabs.find((t: any) => t.tabRenderer?.title === "Vidéos" || t.tabRenderer?.title === "Videos");
      const contents = videosTab?.tabRenderer?.content?.richGridRenderer?.contents || [];

      const videos: Array<{ videoId: string; title: string; thumbnailUrl: string; durationLabel?: string; publishedAt?: Date | null }> = [];
      let continuationToken: string | null = null;

      for (const c of contents) {
        if (c.continuationItemRenderer) {
          continuationToken = c.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || null;
          continue;
        }

        const lockup = c.richItemRenderer?.content?.lockupViewModel;
        if (lockup && lockup.contentId) {
          const vid = lockup.contentId;
          const title = lockup.metadata?.lockupMetadataViewModel?.title?.content || "";
          const thumb = lockup.contentImage?.thumbnailViewModel?.image?.sources?.slice(-1)[0]?.url || `https://i1.ytimg.com/vi/${vid}/hqdefault.jpg`;
          const timeOverlay = lockup.contentImage?.thumbnailViewModel?.overlays?.find((o: any) => o.thumbnailOverlayTimeStatusRenderer);
          const durationLabel = timeOverlay?.thumbnailOverlayTimeStatusRenderer?.text?.content || "";

          videos.push({
            videoId: vid,
            title,
            thumbnailUrl: thumb,
            durationLabel: durationLabel || undefined,
            publishedAt: null,
          });
        } else if (c.richItemRenderer?.content?.videoRenderer) {
          const vr = c.richItemRenderer.content.videoRenderer;
          videos.push({
            videoId: vr.videoId,
            title: vr.title?.runs?.[0]?.text || "",
            thumbnailUrl: vr.thumbnail?.thumbnails?.slice(-1)[0]?.url || `https://i1.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
            durationLabel: vr.lengthText?.simpleText || undefined,
            publishedAt: null,
          });
        }
      }

      // Récupérer une page de continuation supplémentaire (30 vidéos en plus)
      if (continuationToken) {
        try {
          const contRes = await fetch("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
            body: JSON.stringify({
              continuation: continuationToken,
              context: { client: { clientName: "WEB", clientVersion: "2.20231201.00.00" } },
            }),
          });
          if (contRes.ok) {
            const contData = await contRes.json();
            const actions = contData.onResponseReceivedActions || [];
            const contItems = actions[0]?.appendContinuationItemsAction?.continuationItems || [];
            for (const c of contItems) {
              const lockup = c.richItemRenderer?.content?.lockupViewModel;
              if (lockup && lockup.contentId) {
                const vid = lockup.contentId;
                const title = lockup.metadata?.lockupMetadataViewModel?.title?.content || "";
                const thumb = lockup.contentImage?.thumbnailViewModel?.image?.sources?.slice(-1)[0]?.url || `https://i1.ytimg.com/vi/${vid}/hqdefault.jpg`;
                const timeOverlay = lockup.contentImage?.thumbnailViewModel?.overlays?.find((o: any) => o.thumbnailOverlayTimeStatusRenderer);
                const durationLabel = timeOverlay?.thumbnailOverlayTimeStatusRenderer?.text?.content || "";

                videos.push({
                  videoId: vid,
                  title,
                  thumbnailUrl: thumb,
                  durationLabel: durationLabel || undefined,
                  publishedAt: null,
                });
              }
            }
          }
        } catch {
          // Si la continuation échoue, on conserve les vidéos déjà récupérées
        }
      }

      return videos;
    } catch {
      return [];
    }
  }

  /**
   * Résout une chaîne YouTube et prévisualise ses vidéos récentes disponibles dans le flux Atom et l'onglet Vidéos.
   */
  static async previewChannel(rawInput: string, podcastId?: string) {
    const resolved = await YouTubeResolverService.resolveChannel(rawInput);
    
    // Récupérer en parallèle : le flux Atom (15 vidéos récentes avec dates) et l'onglet /videos (60 vidéos régulières, sans Shorts)
    const [feedResult, channelVideos] = await Promise.all([
      SsrfProtectionService.safeFetch(resolved.feedUrl)
        .then((res) => RssParserService.parseXml(res.text))
        .catch(() => ({ items: [] as ParsedRssItem[] })),
      this.fetchChannelVideosTab(resolved.channelId, resolved.customUrl),
    ]);

    // Combiner les deux sources de façon intelligente :
    // 1. D'abord les vidéos de l'onglet /videos (qui exclut nativement les Shorts)
    // 2. Compléter ou fusionner avec les métadonnées riches de l'Atom feed (dates de publication, descriptions)
    const feedItemMap = new Map<string, ParsedRssItem>();
    feedResult.items.forEach((item) => {
      if (item.youtubeVideoId) feedItemMap.set(item.youtubeVideoId, item);
    });

    const regularVideoIds = new Set<string>();
    const combinedVideos: Array<{
      videoId: string;
      title: string;
      description: string;
      publishedAt: Date | null;
      thumbnailUrl: string;
      canonicalUrl: string;
      durationLabel?: string;
      durationSeconds: number | null;
      isLikelyShort: boolean;
    }> = [];

    // Ajouter toutes les vidéos de l'onglet /videos
    for (const v of channelVideos) {
      regularVideoIds.add(v.videoId);
      const feedItem = feedItemMap.get(v.videoId);
      combinedVideos.push({
        videoId: v.videoId,
        title: v.title || feedItem?.title || "Vidéo YouTube",
        description: feedItem?.description ? feedItem.description.slice(0, 300) : "",
        publishedAt: feedItem?.pubDate || null,
        thumbnailUrl: v.thumbnailUrl || feedItem?.thumbnailUrl || `https://i1.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        canonicalUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
        durationLabel: v.durationLabel,
        durationSeconds: feedItem?.durationKnown ? feedItem.durationSeconds : null,
        isLikelyShort: false, // Provient de l'onglet /videos, donc vidéo normale
      });
    }

    // Ajouter les éventuelles vidéos de l'Atom feed non encore présentes
    for (const item of feedResult.items) {
      const vid = item.youtubeVideoId;
      if (!vid || regularVideoIds.has(vid)) continue;

      const isShort =
        item.enclosureUrl.includes("/shorts/") ||
        (item.durationKnown && item.durationSeconds > 0 && item.durationSeconds <= 60) ||
        /#shorts?\b/i.test(item.title) ||
        /#shorts?\b/i.test(item.description || "");

      combinedVideos.push({
        videoId: vid,
        title: item.title,
        description: item.description ? item.description.slice(0, 300) : "",
        publishedAt: item.pubDate,
        thumbnailUrl: item.thumbnailUrl,
        canonicalUrl: item.enclosureUrl,
        durationSeconds: item.durationKnown ? item.durationSeconds : null,
        durationLabel: item.durationKnown ? this.formatDuration(item.durationSeconds) : undefined,
        isLikelyShort: isShort,
      });
    }

    // Vérifier les vidéos déjà importées dans Bamako Podcast
    const allVideoIds = combinedVideos.map((v) => v.videoId);
    const alreadyImported = await prisma.youtubeImportedVideo.findMany({
      where: { videoId: { in: allVideoIds } },
      select: { videoId: true, localEpisodeId: true },
    });
    const importedMap = new Map(alreadyImported.map((a) => [a.videoId, a.localEpisodeId]));

    // Enrichissement par API officielle si la clé serveur est configurée
    const apiKey = process.env.YOUTUBE_API_KEY;
    const enrichedDurations = new Map<string, { durationSeconds: number; embeddable: boolean }>();

    if (apiKey && allVideoIds.length > 0) {
      try {
        const idsParam = allVideoIds.slice(0, 50).join(",");
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

    const videos = combinedVideos.map((v) => {
      const enriched = enrichedDurations.get(v.videoId);
      const isAlready = importedMap.has(v.videoId);
      const durSec = enriched ? enriched.durationSeconds : v.durationSeconds;
      const isLikelyShort = v.isLikelyShort || (enriched ? enriched.durationSeconds <= 60 : false);

      return {
        videoId: v.videoId,
        youtubeVideoId: v.videoId,
        title: v.title,
        description: v.description,
        publishedAt: v.publishedAt,
        thumbnailUrl: v.thumbnailUrl,
        canonicalUrl: v.canonicalUrl,
        duration: durSec,
        durationSeconds: durSec,
        durationLabel: enriched
          ? this.formatDuration(enriched.durationSeconds)
          : v.durationLabel || (durSec ? this.formatDuration(durSec) : "Durée inconnue"),
        isLikelyShort,
        embeddable: enriched ? enriched.embeddable : true,
        alreadyImported: isAlready,
        isAlreadyImported: isAlready,
        localEpisodeId: importedMap.get(v.videoId) || null,
      };
    });

    const regularVideosCount = videos.filter((v) => !v.isLikelyShort).length;
    const shortsCount = videos.filter((v) => v.isLikelyShort).length;

    return {
      channel: resolved,
      hasApiKey: !!apiKey,
      videosCount: videos.length,
      regularVideosCount,
      shortsCount,
      videos,
      items: videos,
      note: apiKey
        ? "Durées et intégrations vérifiées via YouTube Data API v3."
        : `Aperçu étendu : ${videos.length} vidéos trouvées (${regularVideosCount} épisodes complets, ${shortsCount} Shorts).`,
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
    },
    isAdmin = false
  ) {
    if (!isAdmin) {
      const member = await prisma.podcastMember.findUnique({
        where: { podcastId_userId: { podcastId, userId } },
      });
      if (!member || (member.role !== "OWNER" && member.role !== "ADMIN")) {
        throw new Error("FORBIDDEN: Vous n'avez pas les droits nécessaires sur cette émission.");
      }
    }

    const podcast = await prisma.podcast.findUnique({ where: { id: podcastId } });
    if (!podcast) throw new Error("PODCAST_NOT_FOUND: Émission introuvable.");

    const webSubSecret = crypto.randomBytes(24).toString("hex");

    const defaultSettings: YouTubeImportSettings = {
      autoPublish: false, // Brouillon par défaut par sécurité
      excludeShorts: true, // Exclusion des Shorts par défaut
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
