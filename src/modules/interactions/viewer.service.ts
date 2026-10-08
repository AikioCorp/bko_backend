import { prisma } from "../../config/prisma.js";

/** État propre à l'utilisateur connecté (abonnement, favoris, progression), joint aux pages publiques. */
export class ViewerService {
  static async forPodcast(userId: string, podcastId: string, episodeIds: string[]) {
    const [follow, saved, history, likes, rating] = await Promise.all([
      prisma.podcastFollow.findUnique({ where: { userId_podcastId: { userId, podcastId } } }),
      prisma.savedEpisode.findMany({ where: { userId, episodeId: { in: episodeIds } }, select: { episodeId: true } }),
      prisma.playbackHistory.findMany({
        where: { userId, episodeId: { in: episodeIds } },
        select: { episodeId: true, positionSeconds: true, completed: true },
      }),
      prisma.episodeLike.findMany({ where: { userId, episodeId: { in: episodeIds } }, select: { episodeId: true } }),
      prisma.podcastRating.findUnique({ where: { podcastId_userId: { userId, podcastId } } })
    ]);
    return {
      isFollowing: !!follow,
      savedEpisodeIds: saved.map((s) => s.episodeId),
      likedEpisodeIds: likes.map((l) => l.episodeId),
      podcastRating: rating?.score || null,
      progress: Object.fromEntries(history.map((h) => [h.episodeId, { positionSeconds: h.positionSeconds, completed: h.completed }])),
    };
  }

  static async forEpisode(userId: string, episodeId: string, podcastId: string) {
    const v = await this.forPodcast(userId, podcastId, [episodeId]);
    return {
      isFollowing: v.isFollowing,
      isSaved: v.savedEpisodeIds.includes(episodeId),
      isLiked: v.likedEpisodeIds.includes(episodeId),
      podcastRating: v.podcastRating,
      progress: v.progress[episodeId] ?? null,
    };
  }
}
