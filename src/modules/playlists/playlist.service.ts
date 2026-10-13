import { prisma } from "../../config/prisma.js";

export class PlaylistService {
  static async createPlaylist(
    userId: string,
    data: {
      name: string;
      description?: string;
      visibility?: "PUBLIC" | "PRIVATE" | "UNLISTED" | string;
      isPublic?: boolean;
      episodeId?: string;
    }
  ) {
    const rawName = (data?.name || "").trim();
    if (!rawName) {
      throw new Error("Le nom de la playlist est obligatoire");
    }

    // Normalisation de la visibilité
    let visibility: "PUBLIC" | "PRIVATE" | "UNLISTED" = "PUBLIC";
    if (typeof data.isPublic === "boolean") {
      visibility = data.isPublic ? "PUBLIC" : "PRIVATE";
    } else if (data.visibility) {
      const upper = String(data.visibility).trim().toUpperCase();
      if (upper === "PRIVATE" || upper === "UNLISTED") {
        visibility = upper as any;
      }
    }

    // Vérifier l'épisode initial si fourni
    if (data.episodeId) {
      const episode = await prisma.episode.findUnique({
        where: { id: data.episodeId },
      });
      if (!episode) {
        throw new Error("L'épisode spécifié est introuvable");
      }
    }

    const playlist = await prisma.playlist.create({
      data: {
        userId,
        name: rawName,
        description: data.description?.trim() || null,
        visibility,
        ...(data.episodeId
          ? {
              items: {
                create: {
                  episodeId: data.episodeId,
                  position: 1,
                },
              },
            }
          : {}),
      },
      include: {
        _count: { select: { items: true } },
        items: {
          take: 1,
          orderBy: { position: "asc" },
          include: {
            episode: {
              select: {
                id: true,
                title: true,
                cover: true,
                podcast: { select: { cover: true, name: true } },
              },
            },
          },
        },
      },
    });

    return playlist;
  }

  static async getUserPlaylists(userId: string) {
    return prisma.playlist.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { items: true } },
        items: {
          take: 1,
          orderBy: { position: "asc" },
          select: {
            episode: {
              select: {
                id: true,
                title: true,
                cover: true,
                podcast: { select: { cover: true, name: true } },
              },
            },
          },
        },
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

  static async updatePlaylist(
    userId: string,
    id: string,
    data: {
      name?: string;
      description?: string;
      visibility?: "PUBLIC" | "PRIVATE" | "UNLISTED" | string;
      isPublic?: boolean;
    }
  ) {
    const playlist = await prisma.playlist.findUnique({ where: { id } });
    if (!playlist || playlist.userId !== userId) throw new Error("FORBIDDEN");

    const updateData: any = {};
    if (data.name !== undefined) {
      const name = data.name.trim();
      if (!name) throw new Error("Le nom de la playlist ne peut pas être vide");
      updateData.name = name;
    }
    if (data.description !== undefined) {
      updateData.description = data.description.trim() || null;
    }
    if (typeof data.isPublic === "boolean") {
      updateData.visibility = data.isPublic ? "PUBLIC" : "PRIVATE";
    } else if (data.visibility) {
      const upper = String(data.visibility).trim().toUpperCase();
      if (["PUBLIC", "PRIVATE", "UNLISTED"].includes(upper)) {
        updateData.visibility = upper;
      }
    }

    return prisma.playlist.update({
      where: { id },
      data: updateData,
    });
  }

  static async deletePlaylist(userId: string, id: string) {
    const playlist = await prisma.playlist.findUnique({ where: { id } });
    if (!playlist || playlist.userId !== userId) throw new Error("FORBIDDEN");

    await prisma.playlist.delete({ where: { id } });
    return { message: "Playlist supprimée avec succès" };
  }

  static async addItemToPlaylist(userId: string, playlistId: string, episodeId: string) {
    const playlist = await prisma.playlist.findUnique({
      where: { id: playlistId },
      include: { items: true },
    });
    if (!playlist || playlist.userId !== userId) throw new Error("FORBIDDEN");

    const episode = await prisma.episode.findUnique({ where: { id: episodeId } });
    if (!episode) throw new Error("Épisode introuvable");

    // Idempotent : si déjà présent, retourner l'élément sans doubler
    const existing = playlist.items.find((item) => item.episodeId === episodeId);
    if (existing) {
      return existing;
    }

    const position = playlist.items.length + 1;

    const [item] = await prisma.$transaction([
      prisma.playlistItem.create({
        data: {
          playlistId,
          episodeId,
          position,
        },
      }),
      prisma.playlist.update({
        where: { id: playlistId },
        data: { updatedAt: new Date() },
      }),
    ]);

    return item;
  }

  static async removeItemFromPlaylist(userId: string, playlistId: string, episodeId: string) {
    const playlist = await prisma.playlist.findUnique({ where: { id: playlistId } });
    if (!playlist || playlist.userId !== userId) throw new Error("FORBIDDEN");

    await prisma.playlistItem.deleteMany({
      where: { playlistId, episodeId },
    });

    await prisma.playlist.update({
      where: { id: playlistId },
      data: { updatedAt: new Date() },
    });

    return { message: "Épisode retiré de la playlist" };
  }
}
