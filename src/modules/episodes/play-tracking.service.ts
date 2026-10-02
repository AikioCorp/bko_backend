import { prisma } from "../../config/prisma.js";

export type PlayEvent = "start" | "qualified" | "complete" | "progress";

/**
 * Alimente EpisodeDailyStats (base des statistiques créateur).
 *  - start      : début de lecture (+1 écoute ; +1 auditeur unique/jour si connecté et pas encore compté)
 *  - qualified  : écoute "qualifiée" (≥ 30 s) — envoyée une seule fois par le lecteur
 *  - complete   : épisode écouté jusqu'au bout
 *  - progress   : temps d'écoute écoulé (secondes) depuis le dernier envoi, plafonné
 * Seuls les épisodes publiés comptent. Les valeurs sont bornées pour limiter la pollution par un client malveillant.
 */
export class PlayTrackingService {
  static async record(episodeId: string, event: PlayEvent, userId?: string, seconds = 0) {
    const episode = await prisma.episode.findUnique({ where: { id: episodeId }, select: { status: true } });
    if (!episode || episode.status !== "PUBLISHED") throw new Error("EPISODE_NOT_FOUND");

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const inc: Record<string, number> = {};
    if (event === "start") {
      inc.plays = 1;
      if (userId) {
        const history = await prisma.playbackHistory.findUnique({ where: { userId_episodeId: { userId, episodeId } } });
        // Auditeur unique du jour : première lecture de cet épisode aujourd'hui par cet utilisateur.
        if (!history || history.lastPlayedAt < today) inc.uniqueListeners = 1;
      }
    } else if (event === "qualified") {
      inc.qualifiedPlays = 1;
    } else if (event === "complete") {
      inc.completedPlays = 1;
    } else if (event === "progress") {
      inc.totalPlayTimeSeconds = Math.max(0, Math.min(Math.floor(seconds), 600));
    }

    await prisma.episodeDailyStats.upsert({
      where: { episodeId_date: { episodeId, date: today } },
      create: {
        episodeId,
        date: today,
        plays: inc.plays ?? 0,
        qualifiedPlays: inc.qualifiedPlays ?? 0,
        completedPlays: inc.completedPlays ?? 0,
        uniqueListeners: inc.uniqueListeners ?? 0,
        totalPlayTimeSeconds: BigInt(inc.totalPlayTimeSeconds ?? 0),
      },
      update: {
        ...(inc.plays ? { plays: { increment: inc.plays } } : {}),
        ...(inc.qualifiedPlays ? { qualifiedPlays: { increment: inc.qualifiedPlays } } : {}),
        ...(inc.completedPlays ? { completedPlays: { increment: inc.completedPlays } } : {}),
        ...(inc.uniqueListeners ? { uniqueListeners: { increment: inc.uniqueListeners } } : {}),
        ...(inc.totalPlayTimeSeconds ? { totalPlayTimeSeconds: { increment: BigInt(inc.totalPlayTimeSeconds) } } : {}),
      },
    });
  }
}
