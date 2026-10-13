import { prisma } from "../../config/prisma.js";
import { SubscriptionStatus } from "@prisma/client";

/** État propre à l'utilisateur connecté (abonnement, favoris, progression), joint aux pages publiques. */
export class ViewerService {
  static async forPodcast(userId: string, podcastId: string, episodeIds: string[]) {
    const now = new Date();
    const [follow, saved, history, likes, rating, activeSub, purchased] = await Promise.all([
      prisma.podcastFollow.findUnique({ where: { userId_podcastId: { userId, podcastId } } }),
      prisma.savedEpisode.findMany({ where: { userId, episodeId: { in: episodeIds } }, select: { episodeId: true } }),
      prisma.playbackHistory.findMany({
        where: { userId, episodeId: { in: episodeIds } },
        select: { episodeId: true, positionSeconds: true, completed: true },
      }),
      prisma.episodeLike.findMany({ where: { userId, episodeId: { in: episodeIds } }, select: { episodeId: true } }),
      prisma.podcastRating.findUnique({ where: { podcastId_userId: { userId, podcastId } } }),
      prisma.userSubscription.findFirst({
        where: { userId, status: SubscriptionStatus.ACTIVE, currentPeriodEnd: { gt: now } },
      }),
      prisma.paymentTransaction.findMany({
        where: { userId, episodeId: { in: episodeIds }, status: "SUCCESS" },
        select: { episodeId: true },
      }),
    ]);
    return {
      isFollowing: !!follow,
      hasActiveSubscription: !!activeSub,
      savedEpisodeIds: saved.map((s) => s.episodeId),
      likedEpisodeIds: likes.map((l) => l.episodeId),
      purchasedEpisodeIds: purchased.map((p) => p.episodeId as string),
      podcastRating: rating?.score || null,
      progress: Object.fromEntries(history.map((h) => [h.episodeId, { positionSeconds: h.positionSeconds, completed: h.completed }])),
    };
  }

  static async forEpisode(userId: string, episodeId: string, podcastId: string) {
    const v = await this.forPodcast(userId, podcastId, [episodeId]);
    return {
      isFollowing: v.isFollowing,
      hasActiveSubscription: v.hasActiveSubscription,
      isPurchased: v.purchasedEpisodeIds.includes(episodeId),
      isSaved: v.savedEpisodeIds.includes(episodeId),
      isLiked: v.likedEpisodeIds.includes(episodeId),
      podcastRating: v.podcastRating,
      progress: v.progress[episodeId] ?? null,
    };
  }
}

