// Source unique de vérité pour les secrets JWT.
// En production, l'absence (ou la faiblesse) des secrets fait échouer le démarrage :
// on n'utilise JAMAIS un secret par défaut en production.

const DEV_FALLBACK_SECRET = "bamako-podcast-dev-only-jwt-secret-change-me";
const DEV_FALLBACK_REFRESH_SECRET = "bamako-podcast-dev-only-refresh-secret-change-me";

if (process.env.NODE_ENV === "production") {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("FATAL: JWT_SECRET doit être défini en production avec au moins 32 caractères.");
  }
  if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32) {
    throw new Error("FATAL: JWT_REFRESH_SECRET doit être défini en production avec au moins 32 caractères.");
  }
}

export const JWT_SECRET = process.env.JWT_SECRET || DEV_FALLBACK_SECRET;
export const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || DEV_FALLBACK_REFRESH_SECRET;
