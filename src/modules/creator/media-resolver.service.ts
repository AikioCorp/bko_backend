import { ExternalProvider, PlaybackMode, MediaType } from "@prisma/client";

export interface ResolvedMediaSource {
  type: MediaType;
  provider: ExternalProvider;
  playbackMode: PlaybackMode;
  externalUrl: string;
  embedUrl: string | null;
  externalId: string | null;
}

const ALLOWED_EMBED_DOMAINS = [
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "open.spotify.com",
  "podcasts.apple.com",
  "deezer.com",
  "www.deezer.com",
  "soundcloud.com",
  "w.soundcloud.com",
  "vimeo.com",
  "player.vimeo.com",
];

export class MediaResolverService {
  static resolveUrl(rawUrl: string, mediaTypePreference?: MediaType): ResolvedMediaSource {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch (e) {
      throw new Error("INVALID_URL");
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    const isDomainAllowed = ALLOWED_EMBED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith("." + domain));

    // YOUTUBE
    if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
      let videoId = "";
      if (hostname.includes("youtu.be")) {
        videoId = parsedUrl.pathname.substring(1);
      } else {
        videoId = parsedUrl.searchParams.get("v") || "";
      }

      if (!videoId) throw new Error("INVALID_YOUTUBE_URL");

      return {
        type: "VIDEO",
        provider: "YOUTUBE",
        playbackMode: "EMBED",
        externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1`,
        externalId: videoId,
      };
    }

    // SPOTIFY
    if (hostname.includes("spotify.com")) {
      const parts = parsedUrl.pathname.split("/").filter(Boolean);
      const trackOrEpisodeId = parts[parts.length - 1];

      return {
        type: "AUDIO",
        provider: "SPOTIFY",
        playbackMode: "EMBED",
        externalUrl: rawUrl,
        embedUrl: `https://open.spotify.com/embed/${parts.join("/")}`,
        externalId: trackOrEpisodeId || null,
      };
    }

    // VIMEO
    if (hostname.includes("vimeo.com")) {
      const parts = parsedUrl.pathname.split("/").filter(Boolean);
      const vimeoId = parts[0];

      return {
        type: "VIDEO",
        provider: "VIMEO",
        playbackMode: "EMBED",
        externalUrl: rawUrl,
        embedUrl: `https://player.vimeo.com/video/${vimeoId}`,
        externalId: vimeoId || null,
      };
    }

    // APPLE PODCASTS
    if (hostname.includes("apple.com")) {
      return {
        type: "AUDIO",
        provider: "APPLE_PODCASTS",
        playbackMode: "EMBED",
        externalUrl: rawUrl,
        embedUrl: rawUrl.replace("podcasts.apple.com", "embed.podcasts.apple.com"),
        externalId: null,
      };
    }

    // OTHER / GENERIC WEBSITES
    return {
      type: mediaTypePreference || "AUDIO",
      provider: "OTHER",
      playbackMode: isDomainAllowed ? "EMBED" : "EXTERNAL_REDIRECT",
      externalUrl: rawUrl,
      embedUrl: isDomainAllowed ? rawUrl : null,
      externalId: null,
    };
  }
}
