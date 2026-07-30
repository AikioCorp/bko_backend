import dns from "dns/promises";
import net from "net";

export class SsrfProtectionService {
  private static isPrivateIp(ip: string): boolean {
    if (net.isIPv4(ip)) {
      const parts = ip.split(".").map(Number);
      if (parts[0] === 127 || parts[0] === 10) return true; // Loopback & Private Class A
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // Private Class B
      if (parts[0] === 192 && parts[1] === 168) return true; // Private Class C
      if (parts[0] === 169 && parts[1] === 254) return true; // Link-local / Cloud Metadata (169.254.169.254)
      if (parts[0] === 0) return true;
    } else if (net.isIPv6(ip)) {
      if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc00:") || ip.startsWith("fd00:")) return true;
    }
    return false;
  }

  static async validateUrl(rawUrl: string): Promise<string> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch (e) {
      throw new Error("INVALID_RSS_URL");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("RSS_SSRF_BLOCKED");
    }

    const hostname = parsed.hostname;

    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0") {
      throw new Error("RSS_SSRF_BLOCKED");
    }

    // Résolution DNS stricte pour vérifier toutes les IP associées
    try {
      const addresses = await dns.lookup(hostname, { all: true });
      for (const addr of addresses) {
        if (this.isPrivateIp(addr.address)) {
          throw new Error("RSS_SSRF_BLOCKED");
        }
      }
    } catch (err: any) {
      if (err.message === "RSS_SSRF_BLOCKED") throw err;
      throw new Error("RSS_FETCH_FAILED");
    }

    return parsed.href;
  }

  static async safeFetch(
    url: string,
    headers: Record<string, string> = {},
    maxRedirects = 5
  ): Promise<{ text: string; status: number; etag?: string; lastModified?: string }> {
    let currentUrl = url;
    let redirectCount = 0;

    while (redirectCount <= maxRedirects) {
      // Re-validation stricte de l'URL cible à chaque hop de redirection
      const validatedUrl = await this.validateUrl(currentUrl);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s max

      try {
        const response = await fetch(validatedUrl, {
          headers: {
            "User-Agent": "BamakoPodcast-RSSBot/1.0 (+https://bamakopodcast.studio)",
            ...headers,
          },
          signal: controller.signal,
          redirect: "manual", // Ne pas suivre automatiquement les redirections pour pouvoir les re-valider
        });

        clearTimeout(timeoutId);

        if (response.status === 304) {
          return { text: "", status: 304 };
        }

        // Redirections (301, 302, 307, 308)
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location) throw new Error("RSS_REDIRECT_MISSING_LOCATION");

          // Résoudre l'URL relative ou absolue
          currentUrl = new URL(location, validatedUrl).href;
          redirectCount++;
          continue;
        }

        if (!response.ok) {
          throw new Error(`RSS_FETCH_FAILED_HTTP_${response.status}`);
        }

        const contentLength = response.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
          throw new Error("RSS_TOO_LARGE");
        }

        const text = await response.text();
        return {
          text,
          status: response.status,
          etag: response.headers.get("etag") || undefined,
          lastModified: response.headers.get("last-modified") || undefined,
        };
      } catch (e: any) {
        clearTimeout(timeoutId);
        if (e.name === "AbortError") throw new Error("RSS_FETCH_TIMEOUT");
        throw e;
      }
    }

    throw new Error("RSS_TOO_MANY_REDIRECTS");
  }
}
