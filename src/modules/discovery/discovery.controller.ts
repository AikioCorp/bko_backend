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
      const [sections, trending, latestEpisodes] = await Promise.all([
        DiscoveryService.getHomeSections(),
        DiscoveryService.getTrendingPodcasts(60, country),
        prisma.episode.findMany({
          where: { status: "PUBLISHED", podcast: { status: "PUBLISHED" } },
          orderBy: { publishedAt: "desc" },
          take: 10,
          include: {
            podcast: { select: { id: true, name: true, slug: true, cover: true, categories: { include: { category: true } } } },
            mediaSources: true,
            language: true
          }
        })
      ]);
      
      
      // Calcul du Hero Episode : le plus écouté, potentiellement personnalisé
      const userId = (req as any).user?.id;
      let heroEpisode = null;
      
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      // Récupérer les épisodes les plus populaires de la semaine
      const popularEpisodes = await prisma.episode.findMany({
        where: { 
          status: "PUBLISHED",
          podcast: { status: "PUBLISHED" },
          publishedAt: { gte: oneWeekAgo }
        },
        orderBy: { histories: { _count: "desc" } },
        take: 10,
        include: {
          podcast: { select: { id: true, name: true, slug: true, cover: true, categories: { include: { category: true } } } },
          mediaSources: true,
          language: true
        }
      });

      if (popularEpisodes.length > 0) {
        if (userId) {
          // Personnalisation basée sur l'historique
          const history = await prisma.playbackHistory.findMany({
            where: { userId },
            orderBy: { lastPlayedAt: "desc" },
            take: 10,
            include: { episode: { include: { podcast: { include: { categories: true } } } } }
          });
          
          const preferredCategories = new Set(
            history.flatMap(h => h.episode?.podcast?.categories?.map(c => c.categoryId) || [])
          );

          // Trouver le premier épisode populaire qui matche une catégorie préférée et non complété
          const personalizedEpisode = popularEpisodes.find(ep => 
            ep.podcast?.categories?.some(c => preferredCategories.has(c.categoryId))
          );
          
          heroEpisode = personalizedEpisode || popularEpisodes[0];
        } else {
          heroEpisode = popularEpisodes[0];
        }
      } else {
        // Fallback s'il n'y a pas d'épisodes cette semaine
        heroEpisode = latestEpisodes.length > 0 ? latestEpisodes[0] : null;
      }


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
