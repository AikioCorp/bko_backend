import { prisma } from "../../config/prisma.js";

export class InteractionService {
  // --- FOLLOW PODCAST ---
  static async followPodcast(userId: string, podcastId: string) {
    const follow = await prisma.podcastFollow.upsert({
      where: { userId_podcastId: { userId, podcastId } },
      update: {},
      create: { userId, podcastId },
    });
    return follow;
  }

  static async unfollowPodcast(userId: string, podcastId: string) {
    await prisma.podcastFollow.deleteMany({
      where: { userId, podcastId },
    });
    return { message: "Podcast retiré des abonnements" };
  }

  // --- FOLLOW CREATOR ---
  static async followCreator(userId: string, creatorProfileId: string) {
    return prisma.creatorFollow.upsert({
      where: { userId_creatorProfileId: { userId, creatorProfileId } },
      update: {},
      create: { userId, creatorProfileId },
    });
  }

  static async unfollowCreator(userId: string, creatorProfileId: string) {
    await prisma.creatorFollow.deleteMany({
      where: { userId, creatorProfileId },
    });
    return { message: "Créateur retiré des abonnements" };
  }

  // --- SAVE EPISODE ---
  static async saveEpisode(userId: string, episodeId: string) {
    return prisma.savedEpisode.upsert({
      where: { userId_episodeId: { userId, episodeId } },
      update: {},
      create: { userId, episodeId },
    });
  }

  static async unsaveEpisode(userId: string, episodeId: string) {
    await prisma.savedEpisode.deleteMany({
      where: { userId, episodeId },
    });
    return { message: "Épisode retiré de la bibliothèque" };
  }

  static async getSavedEpisodes(userId: string) {
    const saved = await prisma.savedEpisode.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        episode: {
          include: {
            podcast: { include: { country: true } },
            mediaSources: true,
          },
        },
      },
    });
    return saved.map((s) => s.episode);
  }

  // --- PLAYBACK HISTORY & CONTINUE LISTENING ---
  static async updatePlaybackHistory(
    userId: string,
    episodeId: string,
    positionSeconds: number,
    durationSeconds?: number
  ) {
    // Règle de completion : 95% de la durée atteinte
    const isCompleted = durationSeconds ? positionSeconds >= durationSeconds * 0.95 : false;

    return prisma.playbackHistory.upsert({
      where: { userId_episodeId: { userId, episodeId } },
      update: {
        positionSeconds,
        completed: isCompleted,
        lastPlayedAt: new Date(),
      },
      create: {
        userId,
        episodeId,
        positionSeconds,
        completed: isCompleted,
        lastPlayedAt: new Date(),
      },
    });
  }

  static async getContinueListening(userId: string, limit = 10) {
    const histories = await prisma.playbackHistory.findMany({
      where: {
        userId,
        completed: false, // Seulement les épisodes non terminés
      },
      orderBy: { lastPlayedAt: "desc" },
      take: limit,
      include: {
        episode: {
          include: {
            podcast: { include: { country: true } },
            mediaSources: true,
          },
        },
      },
    });
    return histories;
  }

  static async getHistory(userId: string, limit = 30, offset = 0) {
    return prisma.playbackHistory.findMany({
      where: { userId },
      orderBy: { lastPlayedAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        episode: {
          include: {
            podcast: { include: { country: true } },
            mediaSources: true,
          },
        },
      },
    });
  }

  static async deleteHistoryItem(userId: string, episodeId: string) {
    await prisma.playbackHistory.deleteMany({
      where: { userId, episodeId },
    });
    return { message: "Élément retiré de l'historique" };
  }

  static async clearHistory(userId: string) {
    await prisma.playbackHistory.deleteMany({
      where: { userId },
    });
    return { message: "Historique intégralement effacé" };
  }
}
