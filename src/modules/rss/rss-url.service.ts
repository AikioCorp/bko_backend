/**
 * Normalisation et contrôle des adresses de flux RSS saisies par un administrateur ou un créateur.
 *
 * - Refuse les liens d'annuaires (Apple Podcasts, Spotify…) : ce ne sont pas des flux RSS et leur
 *   conversion automatique n'est pas prise en charge.
 * - Produit une forme canonique stable pour détecter les doublons.
 *
 * La protection contre les adresses internes (SSRF) reste portée par SsrfProtectionService.
 */

export type RssDirectoryProvider = "APPLE_PODCASTS" | "SPOTIFY" | "OTHER_DIRECTORY";

export class RssUrlError extends Error {
  readonly provider?: RssDirectoryProvider;

  constructor(code: "INVALID_RSS_URL" | "RSS_DIRECTORY_URL_UNSUPPORTED", provider?: RssDirectoryProvider) {
    super(code);
    this.name = "RssUrlError";
    this.provider = provider;
  }
}

const DIRECTORY_HOSTS: Array<{ test: (host: string) => boolean; provider: RssDirectoryProvider }> = [
  {
    provider: "APPLE_PODCASTS",
    test: (h) => h === "podcasts.apple.com" || h === "itunes.apple.com" || h === "music.apple.com",
  },
  {
    provider: "SPOTIFY",
    test: (h) => h === "open.spotify.com" || h === "spotify.link" || h === "podcasters.spotify.com",
  },
  {
    provider: "OTHER_DIRECTORY",
    test: (h) =>
      h === "podcasts.google.com" ||
      h === "deezer.com" ||
      h.endsWith(".deezer.com") ||
      h === "castbox.fm" ||
      h === "player.fm" ||
      h === "overcast.fm" ||
      h === "pca.st" ||
      h === "pocketcasts.com",
  },
];

export class RssUrlService {
  /** Détecte un lien d'annuaire sans lever d'erreur (utile côté interface). */
  static detectDirectory(raw: string): RssDirectoryProvider | null {
    let parsed: URL;
    try {
      parsed = new URL(raw.trim());
    } catch {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    return DIRECTORY_HOSTS.find((d) => d.test(host))?.provider ?? null;
  }

  /**
   * Valide la syntaxe et renvoie l'URL canonique (schéma + hôte en minuscules, sans fragment,
   * sans barre oblique finale superflue).
   * @throws RssUrlError INVALID_RSS_URL | RSS_DIRECTORY_URL_UNSUPPORTED
   */
  static normalize(raw: string): string {
    if (typeof raw !== "string" || !raw.trim()) throw new RssUrlError("INVALID_RSS_URL");

    let parsed: URL;
    try {
      parsed = new URL(raw.trim());
    } catch {
      throw new RssUrlError("INVALID_RSS_URL");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new RssUrlError("INVALID_RSS_URL");
    }
    if (parsed.username || parsed.password) {
      // Les identifiants dans l'URL se retrouveraient en clair en base et dans les journaux.
      throw new RssUrlError("INVALID_RSS_URL");
    }

    const directory = this.detectDirectory(parsed.href);
    if (directory) throw new RssUrlError("RSS_DIRECTORY_URL_UNSUPPORTED", directory);

    parsed.hash = "";
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/") && !parsed.search) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }
    return parsed.href;
  }

  /**
   * Variantes sous lesquelles une même adresse a pu être enregistrée (avec ou sans barre finale,
   * valeur brute saisie) — sert à retrouver un flux déjà connecté.
   */
  static candidates(raw: string): string[] {
    const normalized = this.normalize(raw);
    const set = new Set<string>([normalized, raw.trim()]);
    set.add(normalized.endsWith("/") ? normalized.replace(/\/+$/, "") : `${normalized}/`);
    return [...set];
  }
}
