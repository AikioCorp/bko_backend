import { RssUrlError } from "./rss-url.service.js";

/**
 * Traduction des codes d'erreur internes du moteur RSS en messages compréhensibles,
 * avec le statut HTTP à renvoyer et le caractère (non) temporaire de l'erreur.
 */
export interface RssErrorInfo {
  code: string;
  message: string;
  httpStatus: number;
  /** true : une nouvelle tentative automatique peut réussir (réseau, serveur distant en panne). */
  transient: boolean;
}

/** Erreur métier remontée par les services d'import (doublon, validation…). */
export class RssImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 400,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "RssImportError";
  }
}

const HTTP_CODE = /^RSS_FETCH_FAILED_HTTP_(\d{3})$/;

export function describeRssError(err: unknown): RssErrorInfo {
  if (err instanceof RssImportError) {
    return { code: err.code, message: err.message, httpStatus: err.httpStatus, transient: false };
  }

  if (err instanceof RssUrlError) {
    if (err.message === "RSS_DIRECTORY_URL_UNSUPPORTED") {
      const who =
        err.provider === "APPLE_PODCASTS"
          ? "Apple Podcasts"
          : err.provider === "SPOTIFY"
            ? "Spotify"
            : "un annuaire de podcasts";
      return {
        code: "RSS_DIRECTORY_URL_UNSUPPORTED",
        message:
          `Ce lien est une page ${who}, pas un flux RSS. La conversion automatique d'un lien ${who} en flux RSS ` +
          "n'est pas prise en charge. Demandez au producteur l'adresse RSS de son émission " +
          "(visible dans son hébergeur : Acast, Anchor, Libsyn, Ausha, Podbean…).",
        httpStatus: 422,
        transient: false,
      };
    }
    return {
      code: "INVALID_RSS_URL",
      message: "L'adresse saisie n'est pas une URL valide. Elle doit commencer par http:// ou https://.",
      httpStatus: 400,
      transient: false,
    };
  }

  const raw = err instanceof Error ? err.message : String(err ?? "");
  const code = raw.trim();

  switch (code) {
    case "INVALID_RSS_URL":
      return {
        code,
        message: "L'adresse saisie n'est pas une URL valide. Elle doit commencer par http:// ou https://.",
        httpStatus: 400,
        transient: false,
      };
    case "RSS_SSRF_BLOCKED":
      return {
        code,
        message:
          "Cette adresse n'est pas autorisée : elle pointe vers un réseau interne ou un protocole non pris en charge. " +
          "Utilisez l'adresse publique du flux RSS.",
        httpStatus: 422,
        transient: false,
      };
    case "RSS_FETCH_FAILED":
      return {
        code,
        message: "Le serveur du flux est introuvable (nom de domaine inconnu ou injoignable). Vérifiez l'adresse.",
        httpStatus: 502,
        transient: true,
      };
    case "RSS_FETCH_TIMEOUT":
      return {
        code,
        message: "Le serveur du flux n'a pas répondu à temps (délai de 10 secondes dépassé). Réessayez dans un instant.",
        httpStatus: 504,
        transient: true,
      };
    case "RSS_TOO_LARGE":
      return {
        code,
        message: "Le flux dépasse la taille maximale acceptée (10 Mo).",
        httpStatus: 422,
        transient: false,
      };
    case "RSS_PARSE_FAILED":
      return {
        code,
        message:
          "Cette adresse ne renvoie pas un flux RSS lisible (le contenu n'est pas du RSS/XML valide). " +
          "Vérifiez que vous avez copié l'adresse du flux et non celle d'une page web.",
        httpStatus: 422,
        transient: false,
      };
    case "RSS_TOO_MANY_REDIRECTS":
    case "RSS_REDIRECT_MISSING_LOCATION":
      return {
        code,
        message: "Le flux redirige de façon incorrecte (trop de redirections). Vérifiez l'adresse.",
        httpStatus: 422,
        transient: false,
      };
    case "RSS_ALL_EPISODES_FAILED":
      return {
        code,
        message: "Aucun épisode du flux n'a pu être importé (données invalides ou erreur d'enregistrement).",
        httpStatus: 500,
        transient: true,
      };
  }

  const http = HTTP_CODE.exec(code);
  if (http) {
    const status = Number(http[1]);
    const transient = status >= 500 || status === 429 || status === 408;
    const message =
      status === 404 || status === 410
        ? `Le flux est introuvable (erreur ${status}). Vérifiez l'adresse.`
        : status === 401 || status === 403
          ? `L'accès au flux est refusé (erreur ${status}). Le flux est peut-être privé ou protégé.`
          : transient
            ? `Le serveur du flux rencontre un problème (erreur ${status}). Réessayez plus tard.`
            : `Le serveur du flux a refusé la demande (erreur ${status}).`;
    return { code, message, httpStatus: 502, transient };
  }

  // Erreurs réseau natives de fetch (DNS, connexion refusée, certificat…)
  if (code === "fetch failed" || (err instanceof Error && (err as any).cause)) {
    return {
      code: "RSS_NETWORK_ERROR",
      message: "Impossible de joindre le serveur du flux (erreur réseau). Réessayez dans un instant.",
      httpStatus: 502,
      transient: true,
    };
  }

  return {
    code: "RSS_IMPORT_FAILED",
    message: "Une erreur inattendue est survenue pendant le traitement du flux.",
    httpStatus: 500,
    transient: true,
  };
}

/** Une erreur permanente ne doit pas être rejouée automatiquement par le worker. */
export function isPermanentRssError(err: unknown): boolean {
  return !describeRssError(err).transient;
}
