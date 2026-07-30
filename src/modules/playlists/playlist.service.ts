import { prisma } from "../../config/prisma.js";

export class PlaylistService {
  static async createPlaylist(userId: string, data: { name: string; description?: string; visibility?: "PUBLIC" | "PRIVATE" | "UNLISTED" }) {
    return prisma.playlist.create({
      data: {
        userId,
        name: data.name,
        description: data.description,
        visibility: data.visibility || "PUBLIC",
      },
    });
  }

  static async getUserPlaylists(userId: string) {
    return prisma.playlist.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { items: true } },
      },
    });
  }

  static async getPlaylistById(id: string, currentUserId?: string) {
    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, avatar: true } },
        items: {
          orderBy: { position: "asc" },
          include: {
            episode: {
              include: {
                podcast: { include: { country: true } },
                mediaSources: true,
              },
            },
          },
        },
      },
    });

    if (!playlist) throw new Error("PLAYLIST_NOT_FOUND");
    if (playlist.visibility === "PRIVATE" && playlist.userId !== currentUserId) {
      throw new Error("FORBIDDEN");
    }

    return playlist;
  }

  static async updatePlaylist(userId: string, id: string, data: { name?: string; description?: string; visibility?: "PUBLIC" | "PRIVATE" | "UNLISTED" }) {
    const playlist = await prisma.playlist.findUnique({ where: { id } });
    if (!playlist || playlist.userId !== userId) throw new Error("FORBIDDEN");

    return prisma.playlist.update({
      where: { id },
      data,
    });
  }

  static async deletePlaylist(userId: string, id: string) {
    const playlist = await prisma.playlist.findUnique({ where: { id } });
    if (!playlist || playlist.userId !== userId) throw new Error("FORBIDDEN");

    await prisma.playlist.delete({ where: { id } });
    return { message: "Playlist supprimée" };
  }

  static async addItemToPlaylist(userId: string, playlistId: string, episodeId: string) {
    const playlist = await prisma.playlist.findUnique({
      where: { id: playlistId },
      include: { items: true },
    });
    if (!playlist || playlist.userId !== userId) throw new Error("FORBIDDEN");

    const position = playlist.items.length + 1;

    return prisma.playlistItem.create({
      data: {
        playlistId,
        episodeId,
        position,
      },
    });
  }

  static async removeItemFromPlaylist(userId: string, playlistId: string, episodeId: string) {
    const playlist = await prisma.playlist.findUnique({ where: { id: playlistId } });
    if (!playlist || playlist.userId !== userId) throw new Error("FORBIDDEN");

    await prisma.playlistItem.deleteMany({
      where: { playlistId, episodeId },
    });
    return { message: "Épisode retiré de la playlist" };
  }
}
