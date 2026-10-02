import dns from "dns/promises";
import net from "net";

export class SsrfProtectionService {
  private static isPrivateIp(ip: string): boolean {
    if (net.isIPv4(ip)) {
      const [a, b] = ip.split(".").map(Number);
      return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) || // CGNAT
        (a === 169 && b === 254) || // link-local / metadata cloud
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 192 && b === 0) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224 // multicast / réservé
      );
    }
    if (net.isIPv6(ip)) {
      const lower = ip.toLowerCase();
      if (lower === "::" || lower === "::1") return true;
      // IPv4 mappée / compatible (::ffff:a.b.c.d ou ::ffff:xxxx:xxxx)
      const mapped = lower.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
      if (mapped) return this.isPrivateIp(mapped[1]);
      const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hex) {
        const hi = parseInt(hex[1], 16);
        const lo = parseInt(hex[2], 16);
        return this.isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
      if (lower.startsWith("64:ff9b:")) return true; // NAT64
      const first = parseInt(lower.split(":")[0] || "0", 16);
      if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
      if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
      if ((first & 0xff00) === 0xff00) return true; // multicast
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

        // Lecture bornée (10 Mo) même sans en-tête content-length.
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.length;
            if (received > 10 * 1024 * 1024) {
              await reader.cancel();
              throw new Error("RSS_TOO_LARGE");
            }
            chunks.push(value);
          }
        }
        const text = Buffer.concat(chunks).toString("utf-8");
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
