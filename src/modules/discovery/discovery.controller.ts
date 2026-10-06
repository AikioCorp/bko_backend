import { Request, Response } from "express";
import { DiscoveryService } from "./discovery.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { prisma } from "../../config/prisma.js";

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
      const country = (req.query.country as string) || "all";
      const sections = await DiscoveryService.getHomeSections();
      const trending = await DiscoveryService.getTrendingPodcasts(60, country);
      
      const latestEpisodes = await prisma.episode.findMany({
        where: { status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        take: 10,
        include: {
          podcast: { select: { id: true, name: true, slug: true, cover: true } },
          mediaSources: true,
          language: true
        }
      });
      
      const heroEpisode = latestEpisodes.length > 0 ? latestEpisodes[0] : null;

      return sendSuccess(res, {
        sections,
        trending,
        latestEpisodes,
        heroEpisode
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
