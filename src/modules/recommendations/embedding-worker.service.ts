import { prisma } from "../../config/prisma.js";
import { EmbeddingService } from "./embedding.service.js";

export class EmbeddingWorkerService {
  /**
   * Traite les épisodes et podcasts récemment publiés ou modifiés sans embeddings valides
   */
  static async processPendingEmbeddings(): Promise<boolean> {
    try {
      const now = new Date();
      const backoffDelay = new Date(Date.now() - 60 * 1000); // 1 minute de délai avant retry

      // 1. Chercher un épisode nécessitant un calcul d'embedding :
      // - Aucun embedding
      // - Échec avec moins de 3 tentatives et délai de backoff écoulé
      // - Épisode mis à jour après la date du dernier calcul d'embedding (détection modification)
      const pendingEpisode = await prisma.episode.findFirst({
        where: {
          status: "PUBLISHED",
          OR: [
            { embeddings: { none: {} } },
            {
              embeddings: {
                some: {
                  status: "FAILED",
                  retryCount: { lt: 3 },
                  updatedAt: { lt: backoffDelay },
                },
              },
            },
            {
              embeddings: {
                some: {
                  status: "COMPLETED",
                  updatedAt: { lt: backoffDelay },
                  episode: {
                    updatedAt: { gt: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
                  },
                },
              },
            },
          ],
        },
        select: { id: true },
      });

      if (pendingEpisode) {
        await EmbeddingService.computeEpisodeEmbedding(pendingEpisode.id);
        return true;
      }

      // 2. Chercher un podcast nécessitant un calcul d'embedding
      const pendingPodcast = await prisma.podcast.findFirst({
        where: {
          status: "PUBLISHED",
          OR: [
            { embeddings: { none: {} } },
            {
              embeddings: {
                some: {
                  status: "FAILED",
                  retryCount: { lt: 3 },
                  updatedAt: { lt: backoffDelay },
                },
              },
            },
          ],
        },
        select: { id: true },
      });

      if (pendingPodcast) {
        await EmbeddingService.computePodcastEmbedding(pendingPodcast.id);
        return true;
      }

      return false;
    } catch (err) {
      console.error("[EmbeddingWorkerService] Erreur lors du calcul d'embedding:", err);
      return false;
    }
  }
}
