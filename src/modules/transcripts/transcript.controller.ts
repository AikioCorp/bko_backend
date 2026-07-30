import { Response } from "express";
import { TranscriptService } from "./transcript.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

export class TranscriptController {
  // --- ENDPOINTS PUBLICS ---
  static async getPublicTranscript(req: AuthenticatedRequest, res: Response) {
    try {
      const transcript = await TranscriptService.getPublicTranscript(req.params.id);
      return sendSuccess(res, transcript);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getChapters(req: AuthenticatedRequest, res: Response) {
    try {
      const chapters = await TranscriptService.getChapters(req.params.id);
      return sendSuccess(res, chapters);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async searchEpisodeTranscript(req: AuthenticatedRequest, res: Response) {
    try {
      const { q } = req.query;
      const results = await TranscriptService.searchEpisodeTranscript(req.params.id, q as string);
      return sendSuccess(res, results);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  // --- ENDPOINTS CRÉATEUR ---
  static async importSubtitles(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { fileContent, languageCode } = req.body;
      if (!fileContent) return sendError(res, "Contenu de fichier SRT/VTT requis", "VALIDATION_ERROR", 400);

      const transcript = await TranscriptService.importSubtitles(req.user.id, req.params.episodeId, fileContent, languageCode);
      return sendSuccess(res, transcript, null, 201);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async generateTranscript(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { languageCode } = req.body;
      const transcript = await TranscriptService.generateTranscript(req.user.id, req.params.episodeId, languageCode);
      return sendSuccess(res, transcript, null, 202);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async updateSegment(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { text, speakerLabel } = req.body;
      const updated = await TranscriptService.updateSegment(req.user.id, req.params.id, text, speakerLabel);
      return sendSuccess(res, updated);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async updateChapters(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { chapters } = req.body;
      const result = await TranscriptService.updateChapters(req.user.id, req.params.episodeId, chapters);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
