import { ExternalProvider, PlaybackMode, MediaType } from "@prisma/client";
import net from "net";

export interface ResolvedMediaSource {
  type: MediaType;
  provider: ExternalProvider;
  playbackMode: PlaybackMode;
  externalUrl: string;
  embedUrl: string | null;
  externalId: string | null;
}

const YOUTUBE_DOMAINS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

const ALLOWED_EMBED_DOMAINS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "open.spotify.com",
  "podcasts.apple.com",
  "deezer.com",
  "www.deezer.com",
  "soundcloud.com",
  "w.soundcloud.com",
  "vimeo.com",
  "player.vimeo.com",
];

function isPrivateOrForbiddenHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !lower ||
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal") ||
    lower === "0.0.0.0" ||
    lower === "::1" ||
    lower === "::"
  ) {
    return true;
  }

  if (net.isIPv4(lower)) {
    const [a, b] = lower.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (net.isIPv6(lower)) {
    if (lower === "::" || lower === "::1") return true;
    const mapped = lower.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateOrForbiddenHost(mapped[1]);
    if (lower.startsWith("64:ff9b:")) return true;
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true;
    if ((first & 0xffc0) === 0xfe80) return true;
    if ((first & 0xff00) === 0xff00) return true;
  }

  return false;
}

function matchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith("." + domain);
}

export class MediaResolverService {
  /**
   * Extrait et valide un identifiant vidéo YouTube (11 caractères) depuis toutes les variantes officielles :
   * - youtube.com/watch?v=... (y compris si v= n'est pas le 1er paramètre)
   * - youtu.be/...
   * - youtube.com/shorts/...
   * - youtube.com/live/...
   * - youtube.com/embed/...
   * - variantes m.youtube.com, music.youtube.com, youtube-nocookie.com
   */
  static extractYoutubeVideoId(parsedUrl: URL): string | null {
    const hostname = parsedUrl.hostname.toLowerCase();
    if (!YOUTUBE_DOMAINS.has(hostname)) {
      return null;
    }

    const segments = parsedUrl.pathname.split("/").filter(Boolean);
    let candidate = "";

    if (hostname === "youtu.be" || hostname === "www.youtu.be") {
      candidate = segments[0] || "";
    } else if (parsedUrl.pathname === "/watch" || segments[0] === "watch") {
      candidate = parsedUrl.searchParams.get("v") || "";
    } else if (
      segments.length >= 2 &&
      (segments[0] === "shorts" ||
        segments[0] === "live" ||
        segments[0] === "embed" ||
        segments[0] === "v")
    ) {
      candidate = segments[1] || "";
    } else {
      candidate = parsedUrl.searchParams.get("v") || "";
    }

    candidate = candidate.trim();
    if (!YOUTUBE_VIDEO_ID_REGEX.test(candidate)) {
      return null;
    }
    return candidate;
  }

  static resolveUrl(rawUrl: string, mediaTypePreference?: MediaType): ResolvedMediaSource {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(String(rawUrl || "").trim());
    } catch (e) {
      throw new Error("INVALID_URL");
    }

    // Seuls http(s) sont acceptés : un lien "javascript:" ou "data:" serait un vecteur XSS une fois affiché.
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw new Error("INVALID_URL");
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    if (isPrivateOrForbiddenHost(hostname)) {
      throw new Error("INVALID_URL");
    }

    // Rejeter explicitement les domaines trompeurs contenant "youtube" ou "youtu.be" sans être un domaine officiel YouTube
    if (
      (hostname.includes("youtube") || hostname.includes("youtu.be")) &&
      !YOUTUBE_DOMAINS.has(hostname)
    ) {
      throw new Error("INVALID_YOUTUBE_URL");
    }

    // YOUTUBE
    if (YOUTUBE_DOMAINS.has(hostname)) {
      const videoId = this.extractYoutubeVideoId(parsedUrl);
      if (!videoId) throw new Error("INVALID_YOUTUBE_URL");

      return {
        type: "VIDEO",
        provider: "YOUTUBE",
        playbackMode: "EMBED",
        externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        embedUrl: `https://www.youtube.com/embed/${videoId}`,
        externalId: videoId,
      };
    }

    const isDomainAllowed = ALLOWED_EMBED_DOMAINS.some((domain) => matchesDomain(hostname, domain));

    // SPOTIFY
    if (matchesDomain(hostname, "spotify.com")) {
      const parts = parsedUrl.pathname.split("/").filter(Boolean);
      const trackOrEpisodeId = parts[parts.length - 1];

      return {
        type: "AUDIO",
        provider: "SPOTIFY",
        playbackMode: "EMBED",
        externalUrl: parsedUrl.href,
        embedUrl: `https://open.spotify.com/embed/${parts.join("/")}`,
        externalId: trackOrEpisodeId || null,
      };
    }

    // VIMEO
    if (matchesDomain(hostname, "vimeo.com")) {
      const parts = parsedUrl.pathname.split("/").filter(Boolean);
      const vimeoId = parts[parts.length - 1] || parts[0];

      return {
        type: "VIDEO",
        provider: "VIMEO",
        playbackMode: "EMBED",
        externalUrl: parsedUrl.href,
        embedUrl: `https://player.vimeo.com/video/${vimeoId}`,
        externalId: vimeoId || null,
      };
    }

    // APPLE PODCASTS
    if (matchesDomain(hostname, "podcasts.apple.com")) {
      return {
        type: "AUDIO",
        provider: "APPLE_PODCASTS",
        playbackMode: "EMBED",
        externalUrl: parsedUrl.href,
        embedUrl: parsedUrl.href.replace("podcasts.apple.com", "embed.podcasts.apple.com"),
        externalId: null,
      };
    }

    // FICHIER MÉDIA DIRECT (.mp3, .m4a, .mp4…) hébergé ailleurs : lu nativement par le lecteur
    const path = parsedUrl.pathname.toLowerCase();
    const audioExt = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/.test(path);
    const videoExt = /\.(mp4|m4v|webm|mov)$/.test(path);
    if (audioExt || videoExt) {
      return {
        type: audioExt ? "AUDIO" : "VIDEO",
        provider: "OTHER",
        playbackMode: "NATIVE",
        externalUrl: parsedUrl.href,
        embedUrl: null,
        externalId: null,
      };
    }

    // OTHER / GENERIC WEBSITES
    return {
      type: mediaTypePreference || "AUDIO",
      provider: "OTHER",
      playbackMode: isDomainAllowed ? "EMBED" : "EXTERNAL_REDIRECT",
      externalUrl: parsedUrl.href,
      embedUrl: isDomainAllowed ? parsedUrl.href : null,
      externalId: null,
    };
  }
}
