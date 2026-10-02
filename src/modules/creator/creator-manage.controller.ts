import { Response } from "express";
import { z } from "zod";
import { CreatorManageService } from "./creator-manage.service.js";
import { PodcastTeamService } from "./podcast-team.service.js";
import { PlayTrackingService } from "../episodes/play-tracking.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

// Erreurs métier → (code HTTP, message). Tout le reste est une 500 générique.
const KNOWN: Record<string, [number, string]> = {
  FORBIDDEN: [403, "Vous n'avez pas les droits nécessaires sur ce podcast"],
  EPISODE_NOT_FOUND: [404, "Épisode introuvable"],
  SEASON_NOT_FOUND: [404, "Saison introuvable"],
  SEASON_EXISTS: [409, "Ce numéro de saison existe déjà"],
  SOURCE_NOT_FOUND: [404, "Source média introuvable"],
  INVALID_STATE: [409, "Cette action n'est pas possible dans l'état actuel de l'épisode"],
  EPISODE_NEEDS_MEDIA: [409, "Un épisode en ligne doit garder au moins une source média"],
  INVALID_URL: [400, "Lien invalide : une adresse http(s) est requise"],
  INVALID_YOUTUBE_URL: [400, "Lien YouTube invalide"],
  MEMBER_NOT_FOUND: [404, "Membre introuvable"],
  CANNOT_REMOVE_OWNER: [409, "Un podcast doit toujours conserver au moins un propriétaire"],
  CANNOT_EDIT_SELF: [400, "Vous ne pouvez pas modifier votre propre rôle"],
  INVITATION_NOT_FOUND: [404, "Invitation introuvable"],
  INVITATION_INVALID: [400, "Invitation invalide ou expirée"],
  INVITATION_EMAIL_MISMATCH: [403, "Cette invitation est destinée à une autre adresse email"],
};

function fail(res: Response, error: unknown) {
  if (error instanceof z.ZodError) return sendError(res, "Données invalides", "VALIDATION_ERROR", 400, error.flatten().fieldErrors);
  const code = error instanceof Error ? error.message : "";
  const known = KNOWN[code];
  if (known) return sendError(res, known[1], code, known[0]);
  console.error("[creator-manage]", error);
  return sendError(res, "Une erreur inattendue est survenue.");
}

const id = z.string().min(1).max(64);
const uid = (req: AuthenticatedRequest) => req.user!.id;
const param = (req: AuthenticatedRequest, name: string) => id.parse(req.params[name]);
const roleEnum = z.enum(["OWNER", "ADMIN", "EDITOR", "ANALYST"]);

const run =
  (fn: (req: AuthenticatedRequest) => Promise<unknown>, status = 200) =>
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      return sendSuccess(res, await fn(req), null, status);
    } catch (e) {
      return fail(res, e);
    }
  };

export class CreatorManageController {
  // Épisodes
  static getEpisode = run((req) => CreatorManageService.getEpisode(uid(req), param(req, "episodeId")));
  static updateEpisode = run((req) => {
    const b = z
      .object({
        title: z.string().min(1).max(200).optional(),
        description: z.string().min(1).max(10000).optional(),
        cover: z.string().url().max(500).nullable().optional(),
        seasonId: id.nullable().optional(),
        episodeNumber: z.number().int().min(0).max(100000).nullable().optional(),
        languageCode: z.string().min(2).max(10).optional(),
        topicIds: z.array(id).max(30).optional(),
        people: z.array(z.object({ personId: id, role: z.string().max(40).optional() })).max(30).optional(),
      })
      .parse(req.body);
    return CreatorManageService.updateEpisode(uid(req), param(req, "episodeId"), b);
  });
  static unpublish = run((req) => CreatorManageService.unpublishEpisode(uid(req), param(req, "episodeId")));
  static unschedule = run((req) => CreatorManageService.unscheduleEpisode(uid(req), param(req, "episodeId")));
  static archive = run((req) => CreatorManageService.archiveEpisode(uid(req), param(req, "episodeId")));
  static restore = run((req) => CreatorManageService.restoreEpisode(uid(req), param(req, "episodeId")));

  // Sources média
  static removeSource = run((req) => CreatorManageService.removeMediaSource(uid(req), param(req, "episodeId"), param(req, "sourceId")));
  static setPrimarySource = run((req) => CreatorManageService.setPrimarySource(uid(req), param(req, "episodeId"), param(req, "sourceId")));
  static previewLink = run((req) => {
    const b = z.object({ url: z.string().min(8).max(2000), mediaType: z.enum(["AUDIO", "VIDEO"]).optional() }).parse(req.body);
    return CreatorManageService.previewLink(b.url, b.mediaType);
  });

  // Saisons
  static listSeasons = run((req) => CreatorManageService.listSeasons(uid(req), param(req, "podcastId")));
  static createSeason = run((req) => {
    const b = z
      .object({
        number: z.number().int().min(1).max(1000).optional(),
        title: z.string().max(200).optional(),
        description: z.string().max(5000).optional(),
        cover: z.string().url().max(500).optional(),
      })
      .parse(req.body);
    return CreatorManageService.createSeason(uid(req), param(req, "podcastId"), b);
  }, 201);
  static updateSeason = run((req) => {
    const b = z
      .object({
        title: z.string().max(200).nullable().optional(),
        description: z.string().max(5000).nullable().optional(),
        cover: z.string().url().max(500).nullable().optional(),
      })
      .parse(req.body);
    return CreatorManageService.updateSeason(uid(req), param(req, "seasonId"), b);
  });
  static deleteSeason = run((req) => CreatorManageService.deleteSeason(uid(req), param(req, "seasonId")));

  // Statistiques
  static analytics = run((req) => {
    const q = z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }).parse(req.query);
    return CreatorManageService.getAnalytics(uid(req), param(req, "podcastId"), q.days);
  });

  // Équipe & invitations
  static updateMember = run((req) => {
    const b = z.object({ role: roleEnum }).parse(req.body);
    return PodcastTeamService.updateMemberRole(uid(req), param(req, "podcastId"), param(req, "userId"), b.role);
  });
  static removeMember = run((req) => PodcastTeamService.removeMember(uid(req), param(req, "podcastId"), param(req, "userId")));
  static listInvitations = run((req) => PodcastTeamService.listInvitations(uid(req), param(req, "podcastId")));
  static revokeInvitation = run((req) => PodcastTeamService.revokeInvitation(uid(req), param(req, "podcastId"), param(req, "invitationId")));
  static acceptInvitation = run((req) => {
    const b = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
    return PodcastTeamService.acceptInvitation(uid(req), b.token);
  });

  // Suivi d'écoute (utilisateur connecté ou anonyme)
  static recordPlay = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const b = z
        .object({ event: z.enum(["start", "qualified", "complete", "progress"]), seconds: z.number().min(0).max(3600).optional() })
        .parse(req.body);
      await PlayTrackingService.record(param(req, "id"), b.event, req.user?.id, b.seconds ?? 0);
      return sendSuccess(res, { ok: true });
    } catch (e) {
      return fail(res, e);
    }
  };
}
