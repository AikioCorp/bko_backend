import crypto from "crypto";
import { XMLParser } from "fast-xml-parser";

export interface ParsedRssItem {
  guid: string;
  title: string;
  description: string;
  pubDate: Date | null;
  enclosureUrl: string;
  enclosureType: string;
  enclosureLength: number | null;
  durationSeconds: number; // 0 ou durée réelle
  durationKnown?: boolean;
  seasonNumber: number | null;
  episodeNumber: number | null;
  keywords: string[];
  mediaType: "AUDIO" | "VIDEO";
  provider: "RSS" | "YOUTUBE";
  thumbnailUrl?: string | null;
  youtubeVideoId?: string;
  youtubeChannelId?: string;
  fingerprint: string;
}

export interface ParsedRssFeed {
  title: string;
  description: string;
  image: string | null;
  author: string | null;
  language: string;
  website: string | null;
  provider: "RSS" | "YOUTUBE";
  channelId?: string;
  items: ParsedRssItem[];
}

export class RssParserService {
  private static parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: false,
    parseTagValue: false,
    trimValues: true,
  });

  static parseXml(xmlText: string): ParsedRssFeed {
    if (!xmlText || typeof xmlText !== "string") {
      throw new Error("RSS_EMPTY_FEED: Le contenu du flux est vide.");
    }

    const trimmed = xmlText.trim();
    if (!trimmed.includes("<rss") && !trimmed.includes("<feed")) {
      throw new Error("RSS_INVALID_FORMAT: Ce fichier XML n'est ni un flux RSS valide ni un flux Atom.");
    }

    let parsedObj: any;
    try {
      parsedObj = this.parser.parse(trimmed);
    } catch (e: any) {
      throw new Error(`RSS_PARSE_FAILED: Erreur d'analyse XML (${e?.message || "syntaxe invalide"}).`);
    }

    // Détection Atom YouTube ou Atom standard
    if (parsedObj.feed) {
      return this.parseAtomFeed(parsedObj.feed);
    }

    // Flux RSS 2.0 standard
    if (parsedObj.rss?.channel) {
      return this.parseRssChannel(parsedObj.rss.channel);
    }

    throw new Error("RSS_UNKNOWN_SCHEMA: Structure de flux XML non reconnue.");
  }

  /**
   * Analyse un flux Atom (spécialement adapté pour YouTube)
   */
  private static parseAtomFeed(feed: any): ParsedRssFeed {
    const channelTitle = this.cleanText(feed.title || "Chaîne YouTube");
    const channelAuthor = typeof feed.author?.name === "string" 
      ? this.cleanText(feed.author.name) 
      : (typeof feed["yt:channelId"] === "string" ? "YouTube" : null);

    const channelId = feed["yt:channelId"] || (feed.id ? String(feed.id).replace(/^yt:channel:/, "") : undefined);
    const channelLink = feed.link?.["@_href"] || feed.author?.uri || (channelId ? `https://www.youtube.com/channel/${channelId}` : null);

    const rawEntries = Array.isArray(feed.entry) ? feed.entry : (feed.entry ? [feed.entry] : []);
    const items: ParsedRssItem[] = [];

    for (const entry of rawEntries) {
      const videoId = entry["yt:videoId"] || (entry.id ? String(entry.id).replace(/^yt:video:/, "") : null);
      if (!videoId) continue; // Ignorer les entrées sans identifiant vidéo

      const entryTitle = this.cleanText(entry.title || "Vidéo sans titre");
      const mediaGroup = entry["media:group"] || {};
      const desc = this.cleanText(mediaGroup["media:description"] || entry.summary || entry.content || "");
      
      const thumbUrl = mediaGroup["media:thumbnail"]?.["@_url"] || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      const pubDateRaw = entry.published || entry.updated;
      const pubDate = pubDateRaw ? new Date(pubDateRaw) : null;

      const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const guid = `yt:video:${videoId}`;

      // Durée uniquement si connue
      let durationSeconds = 0;
      let durationKnown = false;
      if (entry["yt:duration"]?.["@_seconds"]) {
        durationSeconds = parseInt(entry["yt:duration"]["@_seconds"], 10) || 0;
        durationKnown = durationSeconds > 0;
      }

      const fingerprintSource = `${entryTitle}_${pubDate ? pubDate.toISOString() : ""}_${videoId}`;
      const fingerprint = crypto.createHash("sha256").update(fingerprintSource).digest("hex");

      items.push({
        guid,
        title: entryTitle,
        description: desc,
        pubDate: pubDate && !isNaN(pubDate.getTime()) ? pubDate : null,
        enclosureUrl: canonicalUrl,
        enclosureType: "video/youtube",
        enclosureLength: null,
        durationSeconds,
        durationKnown,
        seasonNumber: null,
        episodeNumber: null,
        keywords: [],
        mediaType: "VIDEO",
        provider: "YOUTUBE",
        thumbnailUrl: thumbUrl,
        youtubeVideoId: videoId,
        youtubeChannelId: channelId,
        fingerprint,
      });
    }

    return {
      title: channelTitle,
      description: "",
      image: items[0]?.thumbnailUrl || null,
      author: channelAuthor,
      language: "fr",
      website: channelLink,
      provider: "YOUTUBE",
      channelId,
      items,
    };
  }

  /**
   * Analyse un flux RSS 2.0 audio/vidéo classique
   */
  private static parseRssChannel(channel: any): ParsedRssFeed {
    const channelTitle = this.cleanText(channel.title || "Podcast RSS");
    const channelDesc = this.cleanText(channel.description || "");
    const channelImage = channel["itunes:image"]?.["@_href"] || channel.image?.url || null;
    const channelAuthor = this.cleanText(channel["itunes:author"] || channel.managingEditor || "");
    const channelLang = channel.language ? String(channel.language).trim().toLowerCase().slice(0, 2) : "fr";
    const channelLink = typeof channel.link === "string" ? channel.link.trim() : null;

    const rawItems = Array.isArray(channel.item) ? channel.item : (channel.item ? [channel.item] : []);
    const items: ParsedRssItem[] = [];

    for (const item of rawItems) {
      const enclosure = item.enclosure;
      const encUrl = enclosure?.["@_url"]?.trim();
      if (!encUrl) continue; // Les épisodes RSS doivent avoir un fichier média

      const itemTitle = this.cleanText(item.title || "Épisode sans titre");
      const guid = item.guid?.["#text"] || (typeof item.guid === "string" ? item.guid : encUrl);
      const desc = this.cleanText(item.description || item["itunes:summary"] || "");

      const pubDateRaw = item.pubDate;
      const pubDate = pubDateRaw ? new Date(pubDateRaw) : null;

      const encType = enclosure?.["@_type"]?.trim() || "audio/mpeg";
      const encLength = enclosure?.["@_length"] ? parseInt(enclosure["@_length"], 10) : null;
      const mediaType: "AUDIO" | "VIDEO" = encType.toLowerCase().includes("video") ? "VIDEO" : "AUDIO";

      const rawDuration = item["itunes:duration"];
      const durationSeconds = rawDuration ? this.parseDuration(String(rawDuration).trim()) : 0;
      const durationKnown = durationSeconds > 0;

      const thumbUrl = item["itunes:image"]?.["@_href"] || null;

      const fingerprintSource = `${itemTitle}_${pubDate ? pubDate.toISOString() : ""}_${durationSeconds}`;
      const fingerprint = crypto.createHash("sha256").update(fingerprintSource).digest("hex");

      items.push({
        guid,
        title: itemTitle,
        description: desc,
        pubDate: pubDate && !isNaN(pubDate.getTime()) ? pubDate : null,
        enclosureUrl: encUrl,
        enclosureType: encType,
        enclosureLength: isNaN(encLength as number) ? null : encLength,
        durationSeconds,
        durationKnown,
        seasonNumber: item["itunes:season"] ? parseInt(item["itunes:season"], 10) : null,
        episodeNumber: item["itunes:episode"] ? parseInt(item["itunes:episode"], 10) : null,
        keywords: [],
        mediaType,
        provider: "RSS",
        thumbnailUrl: thumbUrl,
        fingerprint,
      });
    }

    return {
      title: channelTitle,
      description: channelDesc,
      image: channelImage,
      author: channelAuthor || null,
      language: channelLang,
      website: channelLink,
      provider: "RSS",
      items,
    };
  }

  private static cleanText(text: any): string {
    if (!text || typeof text !== "string") return "";
    return text
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  private static parseDuration(raw: string): number {
    if (!raw) return 0;
    if (raw.includes(":")) {
      const parts = raw.split(":").map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
    }
    const parsed = parseInt(raw, 10);
    return isNaN(parsed) ? 0 : parsed;
  }
}
