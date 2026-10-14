import crypto from "crypto";

export class YouTubeWebSubService {
  private static HUB_URL = "https://pubsubhubbub.appspot.com/subscribe";

  /**
   * Retourne l'URL de sujet (topic) officielle pour une chaîne YouTube.
   */
  static getTopicUrl(channelId: string): string {
    return `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;
  }

  /**
   * Demande un abonnement WebSub auprès du Hub Google pour être notifié instantanément
   * des nouvelles vidéos publiées sur la chaîne.
   */
  static async subscribe(channelId: string, secret: string): Promise<{ success: boolean; message: string }> {
    const callbackUrl = process.env.WEBSUB_CALLBACK_URL;
    if (!callbackUrl || !callbackUrl.startsWith("https://")) {
      return {
        success: false,
        message: "WEBSUB_CONFIG_MISSING: WEBSUB_CALLBACK_URL HTTPS public manquant. La synchronisation périodique assurera la relève.",
      };
    }

    const topicUrl = this.getTopicUrl(channelId);
    const params = new URLSearchParams({
      "hub.callback": callbackUrl,
      "hub.mode": "subscribe",
      "hub.topic": topicUrl,
      "hub.secret": secret,
      "hub.lease_seconds": "864000", // 10 jours (standard Google)
    });

    try {
      const response = await fetch(this.HUB_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      if (response.status === 202 || response.status === 200 || response.status === 204) {
        return {
          success: true,
          message: "Abonnement WebSub demandé auprès du Hub Google avec succès.",
        };
      }

      const text = await response.text();
      return {
        success: false,
        message: `Erreur Hub (${response.status}): ${text.slice(0, 200)}`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Échec requête WebSub: ${err?.message || "erreur réseau"}`,
      };
    }
  }

  /**
   * Se désabonne auprès du Hub Google lors de la déconnexion de la chaîne.
   */
  static async unsubscribe(channelId: string, secret: string): Promise<boolean> {
    const callbackUrl = process.env.WEBSUB_CALLBACK_URL;
    if (!callbackUrl) return false;

    const topicUrl = this.getTopicUrl(channelId);
    const params = new URLSearchParams({
      "hub.callback": callbackUrl,
      "hub.mode": "unsubscribe",
      "hub.topic": topicUrl,
      "hub.secret": secret,
    });

    try {
      const res = await fetch(this.HUB_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  /**
   * Vérifie la signature cryptographique HMAC-SHA1 de la notification reçue de Google.
   */
  static verifySignature(rawBody: string | Buffer, signatureHeader: string | undefined, secret: string): boolean {
    if (!signatureHeader || !secret) return false;

    const [algo, signature] = signatureHeader.split("=");
    if (algo !== "sha1" || !signature) return false;

    try {
      const expected = crypto.createHmac("sha1", secret).update(rawBody).digest("hex");
      const sigBuf = Buffer.from(signature, "hex");
      const expBuf = Buffer.from(expected, "hex");

      if (sigBuf.length !== expBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch {
      return false;
    }
  }

  /**
   * Valide le challenge envoyé par Google lors de la vérification de l'URL de callback (GET).
   */
  static handleChallenge(query: Record<string, any>, expectedTopicUrl?: string): { valid: boolean; challenge?: string } {
    const mode = query["hub.mode"];
    const topic = query["hub.topic"];
    const challenge = query["hub.challenge"];

    if ((mode !== "subscribe" && mode !== "unsubscribe") || !challenge) {
      return { valid: false };
    }

    if (expectedTopicUrl && topic !== expectedTopicUrl) {
      return { valid: false };
    }

    return { valid: true, challenge: String(challenge) };
  }
}
