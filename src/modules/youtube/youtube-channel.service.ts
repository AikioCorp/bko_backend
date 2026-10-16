import { YouTubeCatalogService } from "./youtube-catalog.service.js";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "../../config/prisma.js";
import { SsrfProtectionService } from "../../services/ssrf-protection.service.js";
import { RssParserService, ParsedRssItem } from "../rss/rss-parser.service.js";
import { YouTubeResolverService } from "./youtube-resolver.service.js";
import { YouTubeWebSubService } from "./youtube-websub.service.js";

export interface YouTubeImportSettings {
  autoPublish: boolean;
  autoSyncFuture?: boolean;
  initialImportMode?: "SELECT" | "FUTURE_ONLY";
  futureSince?: string;
  includeKeywords?: string[];
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
  static async previewChannel(rawInput: string, podcastId?: string, pageToken?: string, discovery: unknown = {}) {
    const options = z.object({mode:z.enum(["STANDARD","SHORTS","ALL"]).default("ALL")}).parse(discovery);
    const likelyShort=(item:any)=>/#shorts?\b/i.test(item.title+" "+(item.description||""));
    const matches=(item:any)=>options.mode==="ALL"||(options.mode==="SHORTS"?likelyShort(item):!likelyShort(item));
    const resolved=await YouTubeResolverService.resolveChannel(rawInput);
    let items:any[],nextPageToken:string|null=null,totalResults:number|null=null;
    if(YouTubeCatalogService.available){
      items=[];let cursor=pageToken;const seen=new Set<string>();const started=Date.now();
      for(let n=0;n<5;n++){
        if(cursor){if(seen.has(cursor))throw new Error("YOUTUBE_PAGINATION_ERROR: Pagination répétée. Réessayez.");seen.add(cursor);}
        const page=await YouTubeCatalogService.page(resolved.channelId,cursor);
        items.push(...page.items);nextPageToken=page.nextPageToken;totalResults=page.totalResults;
        if(!nextPageToken||items.filter(i=>matches(i)&&i.embeddable!==false).length>=20||Date.now()-started>=8000)break;
        cursor=nextPageToken;
      }
      items=[...new Map(items.map(i=>[i.youtubeVideoId,i])).values()];
    }
    else {
      if(pageToken)throw new Error("YOUTUBE_API_KEY_REQUIRED: Une clé YouTube serveur est nécessaire pour les archives.");
      const feed=await SsrfProtectionService.safeFetch(resolved.feedUrl);
      if(feed.status!==200)throw new Error("YOUTUBE_FEED_UNAVAILABLE: Impossible de charger les vidéos récentes.");
      items=RssParserService.parseXml(feed.text).items;
    }
    const ids=items.map(i=>i.youtubeVideoId).filter(Boolean);
    const imported=podcastId?await prisma.youtubeImportedVideo.findMany({where:{videoId:{in:ids},youtubeChannel:{podcastId}},select:{videoId:true,localEpisodeId:true}}):[];
    const map=new Map(imported.map(i=>[i.videoId,i.localEpisodeId]));
    const videos=items.map(i=>({videoId:i.youtubeVideoId,youtubeVideoId:i.youtubeVideoId,title:i.title,description:i.description,publishedAt:i.pubDate,thumbnailUrl:i.thumbnailUrl,canonicalUrl:i.enclosureUrl,durationSeconds:i.durationKnown?i.durationSeconds:null,durationLabel:i.durationKnown?this.formatDuration(i.durationSeconds):"Durée inconnue",embeddable:i.embeddable??null,isLikelyShort:/#shorts?\b/i.test(i.title+" "+i.description),alreadyImported:map.has(i.youtubeVideoId),isAlreadyImported:map.has(i.youtubeVideoId),localEpisodeId:map.get(i.youtubeVideoId)||null}));
    return {channel:resolved,hasApiKey:YouTubeCatalogService.available,source:YouTubeCatalogService.available?"API":"RECENT_FEED",nextPageToken,totalResults,videosCount:videos.length,discoveryMode:options.mode,discoveryStats:{scanned:videos.length,matching:videos.filter(i=>matches(i)).length,excluded:videos.filter(i=>!matches(i)).length,eligible:videos.filter(i=>matches(i)&&i.embeddable!==false&&!i.isAlreadyImported).length},videos,items:videos,note:YouTubeCatalogService.available?"Vidéos chargées depuis l’API YouTube. Parcourez les pages pour retrouver les anciennes vidéos.":"Vidéos récentes uniquement : ce flux ne contient pas toute la chaîne. Configurez la clé YouTube du serveur pour parcourir les archives."};
  }

  static normalizeSettings(input:any={},previous:any={}):YouTubeImportSettings {
    const schema=z.object({autoPublish:z.boolean().optional(),autoSyncFuture:z.boolean().optional(),excludeShorts:z.boolean().optional(),keepManualEdits:z.boolean().optional(),filterKeywords:z.array(z.string().trim().min(1).max(100)).max(30).optional(),includeKeywords:z.array(z.string().trim().min(1).max(100)).max(30).optional(),excludeKeywords:z.array(z.string().trim().min(1).max(100)).max(30).optional(),initialImportMode:z.enum(["SELECT","FUTURE_ONLY"]).optional(),importScope:z.enum(["ALL","LAST_10","SELECT"]).optional(),futureSince:z.string().datetime().optional()});
    const parsed=schema.parse(input);
    return {autoPublish:false,autoSyncFuture:true,excludeShorts:true,keepManualEdits:true,importScope:"SELECT",excludeKeywords:[],...previous,...parsed,filterKeywords:parsed.filterKeywords??parsed.includeKeywords??previous.filterKeywords??previous.includeKeywords??[]};
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

    if(!/^UC[\w-]{22}$/.test(payload.channelId))throw new Error("INVALID_CHANNEL_ID");
    const selection=z.array(z.string().regex(/^[\w-]{11}$/)).max(500).parse(payload.selectedVideoIds??[]);
    const importSettings=this.normalizeSettings(payload.settings);
    const futureOnly=importSettings.initialImportMode==="FUTURE_ONLY";
    if(!futureOnly&&!selection.length)throw new Error("EMPTY_SELECTION: Sélectionnez au moins une vidéo, ou choisissez de suivre uniquement les prochaines publications.");
    const previous=await prisma.youtubeChannelSync.findUnique({where:{podcastId}});
    if(previous && previous.channelId!==payload.channelId)throw new Error("CHANNEL_ALREADY_CONNECTED: Déconnectez la chaîne actuelle avant d’en associer une autre.");
    const canonical=await YouTubeResolverService.resolveChannel(payload.channelId);
    payload={...payload,channelTitle:canonical.title,feedUrl:canonical.feedUrl,uploadsPlaylistId:canonical.uploadsPlaylistId};
    importSettings.futureSince=(previous?.importSettings as any)?.futureSince || previous?.createdAt?.toISOString() || new Date().toISOString();
    const webSubSecret = crypto.randomBytes(24).toString("hex");

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
        syncEnabled: importSettings.autoSyncFuture !== false,
        nextSyncAt: importSettings.autoSyncFuture !== false ? new Date() : null,
        syncStatus: futureOnly ? (importSettings.autoSyncFuture !== false ? "IDLE" : "PAUSED") : "PENDING",
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
        syncEnabled: importSettings.autoSyncFuture !== false,
        nextSyncAt: importSettings.autoSyncFuture !== false ? new Date() : null,
        syncStatus: futureOnly ? (importSettings.autoSyncFuture !== false ? "IDLE" : "PAUSED") : "PENDING",
        importSettings: importSettings as any,
        webSubSecret,
      },
    });

    // Enclencher l'abonnement WebSub en tâche de fond
    if(importSettings.autoSyncFuture !== false) void YouTubeWebSubService.subscribe(payload.channelId, webSubSecret).then(async (res) => {
      await prisma.youtubeChannelSync.update({
        where: { id: channelSync.id },
        data: { webSubStatus: res.success ? "ACTIVE" : "FAILED" },
      });
    }).catch(err=>console.warn("[YouTube WebSub]",err.message));

    // Ajouter la tâche d'importation initiale à la file d'attente JobQueueItem
    if(!futureOnly) await prisma.jobQueueItem.create({
      data: {
        queueName: "youtube-importer",
        jobType: "YOUTUBE_INITIAL_IMPORT",
        payload: {
          youtubeChannelSyncId: channelSync.id,
          podcastId,
          selectedVideoIds: selection,
        },
        status: "PENDING",
      },
    });

    return {
      channelSyncId: channelSync.id,
      syncStatus: futureOnly ? "IDLE" : "PENDING",
      selectedCount: selection.length,
      message: futureOnly ? "Chaîne connectée. Aucune ancienne vidéo ne sera importée." : "Importation placée en file d’attente. Consultez le suivi pour connaître le résultat.",
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
          manual: true,
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
    const updatedSettings = this.normalizeSettings(data.settings || {}, currentSettings);

    const updated = await prisma.youtubeChannelSync.update({
      where: { podcastId },
      data: {
        syncEnabled: data.syncEnabled !== undefined ? z.boolean().parse(data.syncEnabled) : channel.syncEnabled,
        ...(data.syncEnabled===true?{nextSyncAt:new Date()}:data.syncEnabled===false?{nextSyncAt:null}:{}),
        importSettings: updatedSettings as any,
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
  static async historicalImport(userId:string,podcastId:string,options:{pageToken?:string;selectedVideoIds?:string[];mode?:string},isAdmin=false) {
    if(!isAdmin){const member=await prisma.podcastMember.findUnique({where:{podcastId_userId:{podcastId,userId}}});if(!member||!["OWNER","ADMIN"].includes(member.role))throw new Error("FORBIDDEN");}
    const channel=await prisma.youtubeChannelSync.findUnique({where:{podcastId}});
    if(!channel)throw new Error("YOUTUBE_NOT_CONNECTED");
    if(options.selectedVideoIds!==undefined){
      const ids=z.array(z.string().regex(/^[\w-]{11}$/)).min(1).max(500).parse(options.selectedVideoIds);
      // Check ownership of the selected videos before scheduling any mutation.
      const videos=await YouTubeCatalogService.videos(ids,channel.channelId);
      if(videos.length!==new Set(ids).size)throw new Error("VIDEOS_UNAVAILABLE: Certaines vidéos ne sont plus accessibles. Actualisez la sélection.");
      await prisma.jobQueueItem.create({data:{queueName:"youtube-importer",jobType:"YOUTUBE_INITIAL_IMPORT",payload:{youtubeChannelSyncId:channel.id,podcastId,selectedVideoIds:ids},maxAttempts:5}});
      return {selectedCount:ids.length,syncStatus:"PENDING",message:"Importation des archives placée en file d’attente."};
    }
    return this.previewChannel(channel.channelId,podcastId,options.pageToken,{mode:options.mode||"ALL"});
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
