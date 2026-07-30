import { Response } from "express";
import { CreatorProfileService } from "./creator-profile.service.js";
import { CreatorPodcastService } from "./creator-podcast.service.js";
import { CreatorEpisodeService } from "./creator-episode.service.js";
import { PodcastTeamService } from "./podcast-team.service.js";
import { CreatorDashboardService } from "./creator-dashboard.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

export class CreatorController {
  // --- CREATOR PROFILE ---
  static async getProfile(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const profile = await CreatorProfileService.getProfile(req.user.id);
      return sendSuccess(res, profile);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async createProfile(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const profile = await CreatorProfileService.createProfile(req.user.id, req.body);
      return sendSuccess(res, profile, null, 201);
    } catch (error: any) {
      if (error.message === "CREATOR_PROFILE_EXISTS") {
        return sendError(res, "Vous possédez déjà un profil créateur", "CONFLICT", 409);
      }
      return sendError(res, error.message);
    }
  }

  static async updateProfile(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const profile = await CreatorProfileService.updateProfile(req.user.id, req.body);
      return sendSuccess(res, profile);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getPublicProfile(req: AuthenticatedRequest, res: Response) {
    try {
      const profile = await CreatorProfileService.getPublicProfileBySlug(req.params.slug);
      return sendSuccess(res, profile);
    } catch (error: any) {
      return sendError(res, "Profil créateur introuvable", "NOT_FOUND", 404);
    }
  }

  // --- DASHBOARD ---
  static async getDashboard(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const metrics = await CreatorDashboardService.getDashboardMetrics(req.user.id);
      return sendSuccess(res, metrics);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  // --- PODCASTS ---
  static async listPodcasts(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const podcasts = await CreatorPodcastService.listCreatorPodcasts(req.user.id);
      return sendSuccess(res, podcasts);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getPodcastById(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const podcast = await CreatorPodcastService.getPodcastById(req.user.id, req.params.id);
      return sendSuccess(res, podcast);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async createPodcast(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const podcast = await CreatorPodcastService.createPodcast(req.user.id, req.body);
      return sendSuccess(res, podcast, null, 201);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async updatePodcast(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const podcast = await CreatorPodcastService.updatePodcast(req.user.id, req.params.id, req.body);
      return sendSuccess(res, podcast);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async archivePodcast(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const result = await CreatorPodcastService.archivePodcast(req.user.id, req.params.id);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  // --- EPISODES ---
  static async listEpisodes(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const episodes = await CreatorEpisodeService.listEpisodes(
        req.user.id,
        req.params.podcastId,
        req.query.status as any
      );
      return sendSuccess(res, episodes);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async createEpisode(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const episode = await CreatorEpisodeService.createEpisode(req.user.id, req.params.podcastId, req.body);
      return sendSuccess(res, episode, null, 201);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async addMediaSource(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const source = await CreatorEpisodeService.addMediaSource(req.user.id, req.params.episodeId, req.body);
      return sendSuccess(res, source, null, 201);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async publishEpisode(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const episode = await CreatorEpisodeService.publishEpisode(req.user.id, req.params.episodeId);
      return sendSuccess(res, episode);
    } catch (error: any) {
      if (error.message === "VALIDATION_ERROR_NO_MEDIA_SOURCE") {
        return sendError(res, "Au moins une source média est requise avant publication", "VALIDATION_ERROR", 400);
      }
      return sendError(res, error.message);
    }
  }

  static async scheduleEpisode(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { publishAt } = req.body;
      const episode = await CreatorEpisodeService.scheduleEpisode(req.user.id, req.params.episodeId, publishAt);
      return sendSuccess(res, episode);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  // --- TEAM ---
  static async getMembers(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const members = await PodcastTeamService.getMembers(req.user.id, req.params.id);
      return sendSuccess(res, members);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async inviteMember(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { email, role } = req.body;
      const invitation = await PodcastTeamService.createInvitation(req.user.id, req.params.id, email, role);
      return sendSuccess(res, invitation, null, 201);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
