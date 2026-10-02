import { Response } from "express";
import { sendError } from "./response.js";

// Erreurs métier du parcours créateur → statut HTTP + message lisible pour l'interface.
const MAP: Record<string, [number, string]> = {
  FORBIDDEN: [403, "Vous n'avez pas les droits nécessaires sur ce podcast"],
  FORBIDDEN_ONLY_OWNER: [403, "Seul le propriétaire peut effectuer cette action"],
  PODCAST_NOT_FOUND: [404, "Podcast introuvable"],
  EPISODE_NOT_FOUND: [404, "Épisode introuvable"],
  CREATOR_NOT_FOUND: [404, "Créateur introuvable"],
  CREATOR_PROFILE_NOT_FOUND: [404, "Profil créateur introuvable. Créez d'abord votre profil créateur."],
  MARKET_NOT_FOUND: [404, "Marché introuvable"],
  MARKET_NOT_OPEN_FOR_CREATORS: [403, "La création de podcasts n'est pas encore ouverte dans ce pays pour votre compte"],
  MARKET_PUBLISHING_DISABLED: [403, "La publication n'est pas encore ouverte dans ce pays pour votre compte"],
  VALIDATION_ERROR_MISSING_FIELDS: [400, "Le titre et la description sont obligatoires avant publication"],
  VALIDATION_ERROR_NO_MEDIA_SOURCE: [400, "Ajoutez au moins une source média (fichier ou lien) avant de publier"],
  MEDIA_NOT_READY: [409, "Le fichier audio/vidéo est encore en cours de traitement (ou a échoué). Réessayez dans un instant."],
  INVALID_SCHEDULE_DATE: [400, "La date de programmation doit être dans le futur"],
  INVALID_STATE: [409, "Cette action n'est pas possible dans l'état actuel"],
  INVALID_URL: [400, "Lien invalide : une adresse http(s) est requise"],
  INVALID_YOUTUBE_URL: [400, "Lien YouTube invalide"],
  EPISODE_NEEDS_MEDIA: [409, "Un épisode en ligne doit garder au moins une source média"],
};

/** Réponse d'erreur du parcours créateur ; toute erreur inconnue reste une 500 (message masqué en production). */
export function creatorError(res: Response, error: any) {
  const known = MAP[error?.message];
  if (known) return sendError(res, known[1], error.message, known[0]);
  if (typeof error?.message === "string" && error.message.startsWith("FEATURE_DISABLED")) {
    return sendError(res, error.message, "FEATURE_DISABLED", 503);
  }
  console.error("[creator]", error);
  return sendError(res, error?.message || "Une erreur inattendue est survenue.");
}
