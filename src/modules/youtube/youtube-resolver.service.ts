import { SsrfProtectionService } from "../../services/ssrf-protection.service.js";

export interface ResolvedYouTubeChannel {
  channelId: string;
  title: string;
  description: string;
  thumbnailUrl?: string;
  customUrl?: string;
  uploadsPlaylistId: string;
  feedUrl: string;
}

export class YouTubeResolverService {
  /**
   * Extrait et résout un identifiant de chaîne YouTube ou une URL saisie par l'utilisateur.
   * Gère :
   * - Identifiant direct : UCxxxxxxxxxxxxxxxxxxxx
   * - URL avec ID : https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxx
   * - Handle : https://www.youtube.com/@MonHandle ou @MonHandle
   * - URL personnalisée : https://www.youtube.com/c/MonNom ou https://www.youtube.com/user/MonUser
   * Rejette explicitement les URLs de vidéos simples avec un message clair.
   */
  static parseInput(rawInput: string): { type: "CHANNEL_ID" | "HANDLE" | "CHANNEL_URL" | "CUSTOM_URL"; value: string } {
    const input = String(rawInput || "").trim();
    if (!input) {
      throw new Error("URL_OR_ID_REQUIRED: Veuillez saisir une URL de chaîne ou un identifiant YouTube.");
    }

    // Détection d'URL de vidéo isolée
    if (
      /^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)/i.test(input)
    ) {
      throw new Error(
        "VIDEO_URL_NOT_CHANNEL: Ceci est l'adresse d'une vidéo YouTube, pas d'une chaîne. Veuillez entrer l'URL de la chaîne (ex: https://www.youtube.com/@nomDeChaine) ou son identifiant (UC...)."
      );
    }

    // 1. Identifiant direct UC... (24 caractères)
    if (/^UC[a-zA-Z0-9_-]{22}$/.test(input)) {
      return { type: "CHANNEL_ID", value: input };
    }

    // 2. Handle direct (@...)
    if (/^@[a-zA-Z0-9_.-]+$/.test(input)) {
      return { type: "HANDLE", value: input };
    }

    // 3. URL YouTube
    try {
      const url = new URL(input.startsWith("http") ? input : `https://${input}`);
      const hostname = url.hostname.toLowerCase();
      if (!["youtube.com","www.youtube.com","m.youtube.com","youtu.be","www.youtu.be"].includes(hostname)) {
        throw new Error("NOT_YOUTUBE_URL: Cette adresse ne provient pas de YouTube.");
      }

      const pathname = url.pathname;

      // /channel/UC...
      const channelMatch = pathname.match(/\/channel\/(UC[a-zA-Z0-9_-]{22})/i);
      if (channelMatch) {
        return { type: "CHANNEL_ID", value: channelMatch[1] };
      }

      // /@handle
      const handleMatch = pathname.match(/\/(@[a-zA-Z0-9_.-]+)/i);
      if (handleMatch) {
        return { type: "HANDLE", value: handleMatch[1] };
      }

      // /c/name ou /user/name
      if (pathname.startsWith("/c/") || pathname.startsWith("/user/")) {
        return { type: "CUSTOM_URL", value: url.href };
      }

      // Chemin direct /name qui pourrait être un handle sans @
      const directPath = pathname.replace(/^\/+/, "");
      if (directPath && !directPath.includes("/")) {
        return { type: "HANDLE", value: `@${directPath}` };
      }
    } catch (e: any) {
      if (e.message.startsWith("NOT_YOUTUBE_URL") || e.message.startsWith("VIDEO_URL_NOT_CHANNEL")) {
        throw e;
      }
      throw new Error("INVALID_YOUTUBE_INPUT: Impossible de reconnaître l'adresse ou l'identifiant YouTube saisi.");
    }

    throw new Error(
      "UNSUPPORTED_YOUTUBE_FORMAT: Format d'adresse de chaîne non pris en charge. Utilisez https://www.youtube.com/@nom ou l'identifiant UC..."
    );
  }

  /**
   * Résout une chaîne YouTube de manière fiable et sécurisée avec protection SSRF.
   * Retourne l'identifiant canonique UC..., la playlist d'uploads UU... et le flux Atom.
   */
  static async resolveChannel(rawInput: string): Promise<ResolvedYouTubeChannel> {
    const parsed = this.parseInput(rawInput);
    let channelId: string | null = null;
    let customUrl: string | undefined = undefined;

    if (parsed.type === "CHANNEL_ID") {
      channelId = parsed.value;
    } else {
      // Résolution par requête sécurisée sur la page publique YouTube
      const targetUrl = parsed.type === "HANDLE" 
        ? `https://www.youtube.com/${parsed.value}` 
        : parsed.value;
      
      customUrl = targetUrl;

      try {
        const res = await SsrfProtectionService.safeFetch(targetUrl, {
          "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        });

        const html = res.text;

        // Extraction de l'identifiant de chaîne dans les métadonnées officielles YouTube
        const match =
          html.match(/itemprop="identifier" content="(UC[a-zA-Z0-9_-]{22})"/i) ||
          html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/i) ||
          html.match(/href="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/i) ||
          html.match(/<meta property="og:url" content="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/i);

        if (match) {
          channelId = match[1];
        }
      } catch (err: any) {
        throw new Error(
          `YOUTUBE_PAGE_FETCH_FAILED: Impossible d'accéder à la page de la chaîne YouTube (${err?.message || "erreur réseau"}).`
        );
      }
    }

    if (!channelId) {
      throw new Error(
        "CHANNEL_NOT_RESOLVED: Impossible de trouver l'identifiant de cette chaîne YouTube. Vérifiez l'adresse ou essayez avec son identifiant direct UC..."
      );
    }

    // Récupérer le flux officiel Atom pour extraire le titre et la description
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const uploadsPlaylistId = `UU${channelId.slice(2)}`;

    let title = "Chaîne YouTube";
    let description = "";
    let thumbnailUrl: string | undefined;

    try {
      const feedRes = await SsrfProtectionService.safeFetch(feedUrl);
      if (feedRes.status === 200 && feedRes.text) {
        const titleMatch = feedRes.text.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch) title = this.decodeHtml(titleMatch[1]);

        // Première miniature disponible comme repère visuel
        const thumbMatch = feedRes.text.match(/<media:thumbnail[^>]+url="([^"]+)"/i);
        if (thumbMatch) thumbnailUrl = thumbMatch[1];
      }
    } catch {
      // Le flux peut être temporairement indisponible mais l'identifiant est garanti
    }

    return {
      channelId,
      title,
      description,
      thumbnailUrl,
      customUrl,
      uploadsPlaylistId,
      feedUrl,
    };
  }

  private static decodeHtml(text: string): string {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .trim();
  }
}
