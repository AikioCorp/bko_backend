import { Request, Response } from "express";
import { DiscoveryService } from "./discovery.service.js";
import { HeroService } from "./hero.service.js";
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
      const [sections, trending, latestEpisodes, categoryShelves] = await Promise.all([
        DiscoveryService.getHomeSections(),
        DiscoveryService.getTrendingPodcasts(60, country),
        prisma.episode.findMany({
          where: { status: "PUBLISHED", podcast: { status: "PUBLISHED", ...(country !== "all" ? {countryId: country} : {}) } },
          orderBy: { publishedAt: "desc" },
          take: 24,
distinct: ['podcastId'],
          include: {
            podcast: { select: { id: true, name: true, slug: true, cover: true, categories: { include: { category: true } } } },
            mediaSources: true,
            language: true
          }
        }),
        DiscoveryService.getCategoryShelves(country)
      ]);
      
      
      // Slides de la bannière : adaptées à l'utilisateur (si connecté)
      const userId = (req as any).user?.id;
      let heroSlides: any[] = [];
      try {
        heroSlides = await HeroService.build(userId, latestEpisodes, trending);
      } catch (e) {
        heroSlides = [];
      }
      const heroEpisode = heroSlides[0]?.episode || (latestEpisodes.length > 0 ? latestEpisodes[0] : null);

      return sendSuccess(res, {
        sections,
        trending,
        latestEpisodes,
        heroEpisode,
        heroSlides,
        categoryShelves,
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
