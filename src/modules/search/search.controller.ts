import { Request, Response } from "express";
import { SearchService } from "./search.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";

export class SearchController {
  static async search(req: Request, res: Response) {
    try {
      const q = req.query.q as string | undefined;

      if (!q || q.trim().length === 0) {
        return sendSuccess(res, {
          podcasts: [],
          episodes: [],
          people: [],
          topics: [],
          organizations: [],
        });
      }

      const results = await SearchService.searchAll(q);
      return sendSuccess(res, results);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la recherche.");
    }
  }

  static async suggestions(req: Request, res: Response) {
    try {
      const q = req.query.q as string | undefined;

      if (!q || q.trim().length === 0) {
        return sendSuccess(res, []);
      }

      const suggestions = await SearchService.getSuggestions(q);
      return sendSuccess(res, suggestions);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la récupération des suggestions.");
    }
  }
}
