import crypto from "crypto";

export interface ParsedRssItem {
  guid: string;
  title: string;
  description: string;
  pubDate: Date | null;
  enclosureUrl: string;
  enclosureType: string;
  enclosureLength: number | null;
  durationSeconds: number;
  seasonNumber: number | null;
  episodeNumber: number | null; keywords: string[];
  mediaType: "AUDIO" | "VIDEO";
  fingerprint: string;
}

export interface ParsedRssFeed {
  title: string;
  description: string;
  image: string | null;
  author: string | null;
  language: string;
  website: string | null;
  items: ParsedRssItem[];
}

export class RssParserService {
  static parseXml(xmlText: string): ParsedRssFeed {
    if (!xmlText || !xmlText.includes("<rss") && !xmlText.includes("<feed")) {
      throw new Error("RSS_PARSE_FAILED");
    }

    // Extraction naïve & robuste regex pour éviter les dépendances lourdes
    const titleMatch = xmlText.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const descMatch = xmlText.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
    const imageMatch = xmlText.match(/<itunes:image[^>]*href=["']([^"']+)["']/i) || xmlText.match(/<image>[\s\S]*?<url>(.*?)<\/url>/i);
    const authorMatch = xmlText.match(/<itunes:author>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/itunes:author>/i);
    const langMatch = xmlText.match(/<language>(.*?)<\/language>/i);
    const linkMatch = xmlText.match(/<link>(.*?)<\/link>/i);

    const channelTitle = titleMatch ? this.cleanText(titleMatch[1]) : "Podcast RSS";
    const channelDesc = descMatch ? this.cleanText(descMatch[1]) : "";
    const channelImage = imageMatch ? imageMatch[1].trim() : null;
    const channelAuthor = authorMatch ? this.cleanText(authorMatch[1]) : null;
    const channelLang = langMatch ? langMatch[1].trim().toLowerCase().substring(0, 2) : "fr";
    const channelLink = linkMatch ? linkMatch[1].trim() : null;

    // Découper les items
    const itemsRaw = xmlText.split(/<item>/i).slice(1);
    const items: ParsedRssItem[] = [];

    for (const rawItem of itemsRaw) {
      const itemXml = rawItem.split(/<\/item>/i)[0];

      const itemTitleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      const itemGuidMatch = itemXml.match(/<guid[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/guid>/i);
      const itemDescMatch = itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i) || itemXml.match(/<itunes:summary>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/itunes:summary>/i);
      const itemPubDateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/i);
      const itemEnclosureMatch = itemXml.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*>/i);
      const itemEnclosureTypeMatch = itemXml.match(/<enclosure[^>]*type=["']([^"']+)["'][^>]*>/i);
      const itemEnclosureLengthMatch = itemXml.match(/<enclosure[^>]*length=["']([^"']+)["'][^>]*>/i);
      const itemDurationMatch = itemXml.match(/<itunes:duration>(.*?)<\/itunes:duration>/i);
      const itemSeasonMatch = itemXml.match(/<itunes:season>(.*?)<\/itunes:season>/i);
      const itemEpisodeMatch = itemXml.match(/<itunes:episode>(.*?)<\/itunes:episode>/i); const itemCategories = [...itemXml.matchAll(/<category[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/category>/gi)].map(m => m[1]); const itemItunesKeywordsMatch = itemXml.match(/<itunes:keywords>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/itunes:keywords>/i); const keywords = [...new Set([...itemCategories, ...(itemItunesKeywordsMatch ? itemItunesKeywordsMatch[1].split(',') : [])].map(k => k.trim()).filter(Boolean))];

      if (!itemEnclosureMatch) continue; // Ignorer les items sans fichier média

      const itemTitle = itemTitleMatch ? this.cleanText(itemTitleMatch[1]) : "Épisode Sans Titre";
      const enclosureUrl = itemEnclosureMatch[1].trim();
      const guid = itemGuidMatch ? itemGuidMatch[1].trim() : enclosureUrl;
      const pubDate = itemPubDateMatch ? new Date(itemPubDateMatch[1].trim()) : null;
      const enclosureType = itemEnclosureTypeMatch ? itemEnclosureTypeMatch[1].trim() : "audio/mpeg";
      const mediaType: "AUDIO" | "VIDEO" = enclosureType.includes("video") ? "VIDEO" : "AUDIO";
      const durationSeconds = itemDurationMatch ? this.parseDuration(itemDurationMatch[1].trim()) : 1800;

      // Fingerprint normalisé : sha256(itemTitle + pubDate + durationSeconds)
      const fingerprintSource = `${itemTitle}_${pubDate ? pubDate.toISOString() : ""}_${durationSeconds}`;
      const fingerprint = crypto.createHash("sha256").update(fingerprintSource).digest("hex");

      items.push({
        guid,
        title: itemTitle,
        description: itemDescMatch ? this.cleanText(itemDescMatch[1]) : "",
        pubDate: pubDate && !isNaN(pubDate.getTime()) ? pubDate : null,
        enclosureUrl,
        enclosureType,
        enclosureLength: itemEnclosureLengthMatch ? parseInt(itemEnclosureLengthMatch[1], 10) : null,
        durationSeconds, keywords,
        seasonNumber: itemSeasonMatch ? parseInt(itemSeasonMatch[1], 10) : null,
        episodeNumber: itemEpisodeMatch ? parseInt(itemEpisodeMatch[1], 10) : null,
        mediaType,
        fingerprint,
      });
    }

    return {
      title: channelTitle,
      description: channelDesc,
      image: channelImage,
      author: channelAuthor,
      language: channelLang,
      website: channelLink,
      items,
    };
  }

  private static cleanText(text: string): string {
    return text
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
      .replace(/<[^>]+>/g, "")
      .trim();
  }

  private static parseDuration(raw: string): number {
    if (!raw) return 1800;
    if (raw.includes(":")) {
      const parts = raw.split(":").map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
    }
    const parsed = parseInt(raw, 10);
    return isNaN(parsed) ? 1800 : parsed;
  }
}
