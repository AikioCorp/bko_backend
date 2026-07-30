import { Response } from "express";
import { PlaylistService } from "./playlist.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

export class PlaylistController {
  static async createPlaylist(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const playlist = await PlaylistService.createPlaylist(req.user.id, req.body);
      return sendSuccess(res, playlist, null, 201);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getUserPlaylists(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const playlists = await PlaylistService.getUserPlaylists(req.user.id);
      return sendSuccess(res, playlists);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getPlaylistById(req: AuthenticatedRequest, res: Response) {
    try {
      const playlist = await PlaylistService.getPlaylistById(req.params.id, req.user?.id);
      return sendSuccess(res, playlist);
    } catch (error: any) {
      if (error.message === "FORBIDDEN") return sendError(res, "Accès refusé à cette playlist privée", "FORBIDDEN", 403);
      return sendError(res, error.message || "Playlist introuvable", "NOT_FOUND", 404);
    }
  }

  static async updatePlaylist(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const updated = await PlaylistService.updatePlaylist(req.user.id, req.params.id, req.body);
      return sendSuccess(res, updated);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async deletePlaylist(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const result = await PlaylistService.deletePlaylist(req.user.id, req.params.id);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async addItemToPlaylist(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { episodeId } = req.body;
      const item = await PlaylistService.addItemToPlaylist(req.user.id, req.params.id, episodeId);
      return sendSuccess(res, item, null, 201);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async removeItemFromPlaylist(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const result = await PlaylistService.removeItemFromPlaylist(req.user.id, req.params.id, req.params.episodeId);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
