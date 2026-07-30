import { Request, Response } from "express";
import { ReferentialService } from "./referential.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";

export class ReferentialController {
  static async getCategories(req: Request, res: Response) {
    try {
      const data = await ReferentialService.getCategories();
      return sendSuccess(res, data);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur catégories.");
    }
  }

  static async getCategoryBySlug(req: Request, res: Response) {
    try {
      const data = await ReferentialService.getCategoryBySlug(req.params.slug);
      if (!data) return sendError(res, "Catégorie introuvable", "NOT_FOUND", 404);
      return sendSuccess(res, data);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getTopics(req: Request, res: Response) {
    try {
      const data = await ReferentialService.getTopics();
      return sendSuccess(res, data);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur sujets.");
    }
  }

  static async getTopicBySlug(req: Request, res: Response) {
    try {
      const data = await ReferentialService.getTopicBySlug(req.params.slug);
      if (!data) return sendError(res, "Sujet introuvable", "NOT_FOUND", 404);
      return sendSuccess(res, data);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getCountries(req: Request, res: Response) {
    try {
      const data = await ReferentialService.getCountries();
      return sendSuccess(res, data);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur pays.");
    }
  }

  static async getCountryByCode(req: Request, res: Response) {
    try {
      const data = await ReferentialService.getCountryByCode(req.params.code);
      if (!data) return sendError(res, "Pays introuvable", "NOT_FOUND", 404);
      return sendSuccess(res, data);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getLanguages(req: Request, res: Response) {
    try {
      const data = await ReferentialService.getLanguages();
      return sendSuccess(res, data);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur langues.");
    }
  }

  static async getLanguageByCode(req: Request, res: Response) {
    try {
      const data = await ReferentialService.getLanguageByCode(req.params.code);
      if (!data) return sendError(res, "Langue introuvable", "NOT_FOUND", 404);
      return sendSuccess(res, data);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
