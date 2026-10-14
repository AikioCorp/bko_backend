import { prisma } from "../../config/prisma.js";
import { InteractionService } from "../interactions/interaction.service.js";
import { EngagementService } from "../interactions/engagement.service.js";

export class AdvisorService {
  /**
   * 1. HISTORIQUE PERSONNEL & REPRISE DE LECTURE
   * Retourne l'historique d'écoute vérifié côté serveur pour l'utilisateur connecté.
   */
  static async getListeningContext(userId: string) {
    // Dernier épisode interrompu (non terminé)
    const continueListening = await InteractionService.getContinueListening(userId, 1);
    const lastUnfinished = continueListening.length > 0 ? continueListening[0] : null;

    // Liste des IDs d'épisodes déjà terminés (pour ne pas les recommander)
    const completedEpisodes = await prisma.playbackHistory.findMany({
      where: {
        userId,
        completed: true,
      },
      select: {
        episodeId: true,
      },
      take: 100,
    });

    const completedEpisodeIds = completedEpisodes.map((e) => e.episodeId);

    // Formatage propre du dernier épisode interrompu
    let lastPlayed = null;
    if (lastUnfinished && lastUnfinished.episode) {
      const ep = lastUnfinished.episode;
      const pod = ep.podcast;
      const posSec = lastUnfinished.positionSeconds || 0;
      const minutes = Math.floor(posSec / 60);
      const seconds = posSec % 60;
      const formattedPos = `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;

      lastPlayed = {
        episodeId: ep.id,
        episodeTitle: ep.title,
        episodeSlug: ep.slug,
        podcastTitle: pod.name,
        podcastSlug: pod.slug,
        positionSeconds: posSec,
        formattedPosition: formattedPos,
        link: `/podcasts/${pod.slug}/episodes/${ep.slug}`,
      };
    }

    return {
      lastPlayed,
      completedEpisodeIds,
    };
  }

  /**
   * 2. AJOUT AUX FAVORIS (IDEMPOTENT)
   * Trouve l'épisode par mot-clé/slug et l'ajoute aux favoris (EpisodeLike).
   */
  static async addFavorite(userId: string, searchTerm: string) {
    if (!searchTerm || searchTerm.trim().length === 0) {
      return { success: false, code: "MISSING_TERM", message: "Aucun épisode spécifié." };
    }

    const term = searchTerm.trim();

    // Recherche de l'épisode correspondant dans le catalogue publié
    const candidates = await prisma.episode.findMany({
      where: {
        status: "PUBLISHED",
        podcast: { status: "PUBLISHED" },
        OR: [
          { slug: term },
          { title: { contains: term, mode: "insensitive" } },
          { id: term },
        ],
      },
      include: {
        podcast: {
          select: { name: true, slug: true },
        },
      },
      take: 3,
    });

    if (candidates.length === 0) {
      return {
        success: false,
        code: "NOT_FOUND",
        message: `Je n'ai pas trouvé d'épisode correspondant à "${term}" dans le catalogue.`,
      };
    }

    if (candidates.length > 1) {
      // Ambiguïté : plusieurs épisodes correspondent
      return {
        success: false,
        code: "AMBIGUOUS",
        message: "Plusieurs épisodes correspondent. Lequel veux-tu ajouter ?",
        candidates: candidates.map((c) => ({
          id: c.id,
          title: c.title,
          podcast: c.podcast.name,
          slug: c.slug,
        })),
      };
    }

    const episode = candidates[0];

    // Vérifier si déjà en favori
    const existingLike = await prisma.episodeLike.findUnique({
      where: {
        episodeId_userId: {
          episodeId: episode.id,
          userId,
        },
      },
    });

    if (existingLike) {
      return {
        success: true,
        alreadyFavorited: true,
        episode: {
          id: episode.id,
          title: episode.title,
          podcastTitle: episode.podcast.name,
          link: `/podcasts/${episode.podcast.slug}/episodes/${episode.slug}`,
        },
        message: `L'épisode "${episode.title}" est déjà dans tes favoris !`,
      };
    }

    // Ajout idempotent
    await EngagementService.likeEpisode(episode.id, userId);

    return {
      success: true,
      alreadyFavorited: false,
      episode: {
        id: episode.id,
        title: episode.title,
        podcastTitle: episode.podcast.name,
        link: `/podcasts/${episode.podcast.slug}/episodes/${episode.slug}`,
      },
      message: `J'ai bien ajouté "${episode.title}" à tes favoris !`,
    };
  }

  /**
   * 3. PROXY SÉCURISÉ VERS N8N
   * Transmet le message à n8n avec les métadonnées vérifiées côté serveur.
   */
  static async forwardToN8n(params: {
    sessionId: string;
    chatInput: string;
    userId?: string;
    firstName?: string;
    context?: any;
  }) {
    const N8N_URL = process.env.N8N_CHAT_WEBHOOK_URL || "https://bko-n8n.salika.tech/webhook/9881143d-a47b-4638-a326-8679506ff3f0/chat";

    const payload = {
      action: "sendMessage",
      sessionId: params.sessionId,
      chatInput: params.chatInput,
      metadata: {
        isAuthenticated: Boolean(params.userId),
        userId: params.userId || null,
        firstName: params.firstName || null,
        context: params.context || null,
      },
    };

    const response = await fetch(N8N_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Erreur n8n (${response.status})`);
    }

    const data: any = await response.json();
    const rawOutput = data.output || data.text || "Désolé, je n'ai pas pu traiter ta demande.";
    const appUrl = (process.env.APP_URL || "http://x0jn9ljzszcjjvzmiltdx0qd.194.31.52.77.sslip.io").replace(/\/+$/, "");
    const domainPattern = /https?:\/\/(?:www\.)?(?:bamakopodcast\.(?:com|studio|ml)|c0mq60vovgz6xkdvi8hkyejk\.194\.31\.52\.77\.sslip\.io)/gi;
    let normalizedOutput = typeof rawOutput === "string" ? rawOutput.replace(domainPattern, appUrl) : rawOutput;

    // Filtre de sécurité absolu : élimine toute fuite technique (Calling Execute..., SQL, JSON)
    if (typeof normalizedOutput === "string") {
      // Si la réponse n'est qu'un log technique de tool calling
      if (/^\s*Calling\s+[\w_]+.*with\s+input:/i.test(normalizedOutput) || /Execute_a_SQL_query/i.test(normalizedOutput)) {
        normalizedOutput = normalizedOutput
          .replace(/Calling\s+[\w_]+(?:\s+with\s+input:[^}]*}?)?/gi, "")
          .replace(/Execute_a_SQL_query[^\n]*/gi, "")
          .replace(/\{\s*['"]?term['"]?\s*:[^}]*\}/gi, "")
          .trim();

        if (!normalizedOutput) {
          normalizedOutput = "Je consulte le catalogue pour toi... Peux-tu me préciser quel genre de podcast ou de thème tu recherches ?";
        }
      }
    }

    return {
      output: normalizedOutput,
    };
  }
}
