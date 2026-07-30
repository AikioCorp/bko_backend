import { Request, Response } from "express";
import { DiscoveryService } from "./discovery.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";

export class DiscoveryController {
  static async getExplore(req: Request, res: Response) {
    try {
      const data = await DiscoveryService.getExploreData();
      return sendSuccess(res, data);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la récupération des données d'exploration.");
    }
  }

  static async getHome(req: Request, res: Response) {
    try {
      const sections = await DiscoveryService.getHomeSections();
      const trending = await DiscoveryService.getTrendingPodcasts(10, "ML");

      return sendSuccess(res, {
        sections,
        trending,
      });
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la récupération de la page d'accueil.");
    }
  }

  static async getTrending(req: Request, res: Response) {
    try {
      const country = (req.query.country as string) || "ML";
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

      const trending = await DiscoveryService.getTrendingPodcasts(limit, country);
      return sendSuccess(res, trending);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors du calcul des tendances.");
    }
  }
}
