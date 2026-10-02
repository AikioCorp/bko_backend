import { prisma } from "../../config/prisma.js";

/** État propre à l'utilisateur connecté (abonnement, favoris, progression), joint aux pages publiques. */
export class ViewerService {
  static async forPodcast(userId: string, podcastId: string, episodeIds: string[]) {
    const [follow, saved, history] = await Promise.all([
      prisma.podcastFollow.findUnique({ where: { userId_podcastId: { userId, podcastId } } }),
      prisma.savedEpisode.findMany({ where: { userId, episodeId: { in: episodeIds } }, select: { episodeId: true } }),
      prisma.playbackHistory.findMany({
        where: { userId, episodeId: { in: episodeIds } },
        select: { episodeId: true, positionSeconds: true, completed: true },
      }),
    ]);
    return {
      isFollowing: !!follow,
      savedEpisodeIds: saved.map((s) => s.episodeId),
      progress: Object.fromEntries(history.map((h) => [h.episodeId, { positionSeconds: h.positionSeconds, completed: h.completed }])),
    };
  }

  static async forEpisode(userId: string, episodeId: string, podcastId: string) {
    const v = await this.forPodcast(userId, podcastId, [episodeId]);
    return {
      isFollowing: v.isFollowing,
      isSaved: v.savedEpisodeIds.includes(episodeId),
      progress: v.progress[episodeId] ?? null,
    };
  }
}
