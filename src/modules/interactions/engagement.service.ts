import { prisma } from "../../config/prisma.js";
import { UserProfileService } from "../recommendations/user-profile.service.js";

// Stores en mémoire pour likes et réactions sur les commentaires
const commentLikesMap = new Map<string, Set<string>>(); // commentId -> Set<userId>
const commentReactionsMap = new Map<string, Map<string, string>>(); // commentId -> Map<userId, emoji>

export class EngagementService {
  // --- RATINGS ---
  static async ratePodcast(podcastId: string, userId: string, score: number) {
    if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error("La note doit être un entier entre 1 et 5");
    
    // Check if podcast exists and is published
    const podcast = await prisma.podcast.findUnique({
      where: { id: podcastId },
      select: { status: true }
    });
    if (!podcast || (podcast.status !== "PUBLISHED" && podcast.status !== "UNLISTED")) {
      throw new Error("Podcast introuvable ou non publié");
    }

    return prisma.podcastRating.upsert({
      where: { podcastId_userId: { podcastId, userId } },
      update: { score },
      create: { podcastId, userId, score }
    });
  }

  static async deletePodcastRating(podcastId: string, userId: string) {
    await prisma.podcastRating.deleteMany({ where: { podcastId, userId } });
    return true;
  }

  static async getPodcastRatings(podcastId: string, userId?: string) {
    const podcast = await prisma.podcast.findUnique({ where: { id: podcastId }, select: { status: true } });
    if (!podcast || !["PUBLISHED", "UNLISTED"].includes(podcast.status)) throw new Error("Podcast introuvable ou non publié");
    const aggregations = await prisma.podcastRating.aggregate({
      where: { podcastId },
      _avg: { score: true },
      _count: { id: true }
    });

    let userRating = null;
    if (userId) {
      userRating = await prisma.podcastRating.findUnique({
        where: { podcastId_userId: { podcastId, userId } }
      });
    }

    return {
      average: aggregations._avg.score ? Math.round(aggregations._avg.score * 10) / 10 : null,
      count: aggregations._count.id,
      userRating: userRating?.score || null
    };
  }

  // --- LIKES ---
  static async likeEpisode(episodeId: string, userId: string) {
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: { status: true, podcast: { select: { status: true } } }
    });
    if (!episode || (episode.status !== "PUBLISHED" && episode.status !== "UNLISTED") || (episode.podcast.status !== "PUBLISHED" && episode.podcast.status !== "UNLISTED")) {
      throw new Error("Épisode introuvable");
    }

    const result = await prisma.episodeLike.upsert({
      where: { episodeId_userId: { episodeId, userId } },
      update: {},
      create: { episodeId, userId }
    });
    UserProfileService.invalidateProfile(userId).catch(() => {});
    return result;
  }

  static async unlikeEpisode(episodeId: string, userId: string) {
    await prisma.episodeLike.deleteMany({ where: { episodeId, userId } });
    UserProfileService.invalidateProfile(userId).catch(() => {});
    return true;
  }

  // --- COMMENTS ---
  static async createComment(episodeId: string, userId: string, text: string) {
    if (typeof text !== "string") throw new Error("Le commentaire doit être un texte");
    const cleanText = text.trim();
    if (cleanText.length < 1 || cleanText.length > 2000) {
      throw new Error("Le commentaire doit faire entre 1 et 2000 caractères");
    }

    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: { status: true, allowComments: true, podcast: { select: { status: true } } }
    });

    if (!episode || (episode.status !== "PUBLISHED" && episode.status !== "UNLISTED") || (episode.podcast.status !== "PUBLISHED" && episode.podcast.status !== "UNLISTED")) {
      throw new Error("Épisode introuvable");
    }
    if (!episode.allowComments) {
      throw new Error("Les commentaires sont fermés pour cet épisode");
    }

    return prisma.comment.create({
      data: {
        episodeId,
        userId,
        text: cleanText
      },
      include: {
        user: {
          select: { id: true, fullName: true, avatar: true, username: true }
        }
      }
    });
  }

  static async deleteComment(commentId: string, userId: string) {
    const comment = await prisma.comment.findUnique({ 
      where: { id: commentId },
      include: { episode: { select: { podcastId: true } } }
    });
    if (!comment) throw new Error("Commentaire introuvable");

    if (comment.userId === userId) {
      // L'auteur peut supprimer son commentaire complètement
      await prisma.comment.delete({ where: { id: commentId } });
      commentLikesMap.delete(commentId);
      commentReactionsMap.delete(commentId);
      return { action: "deleted" };
    }

    // Vérifier si l'utilisateur est membre du podcast (pour modération) ou admin global
    const [member, userRoles] = await Promise.all([
      prisma.podcastMember.findUnique({
        where: { podcastId_userId: { podcastId: comment.episode.podcastId, userId } }
      }),
      prisma.userRole.findMany({
        where: { userId },
        include: { role: true }
      })
    ]);

    const isGlobalMod = userRoles.some(ur => ur.role.name === 'ADMIN' || ur.role.name === 'MODERATOR');
    const isPodcastMod = member && (member.role === 'OWNER' || member.role === 'ADMIN');

    if (isGlobalMod || isPodcastMod) {
      // Modération: masquer le commentaire
      await prisma.comment.update({
        where: { id: commentId },
        data: { isVisible: false }
      });
      return { action: "hidden" };
    }

    throw new Error("Action non autorisée");
  }

  static async listComments(episodeId: string, limit: number, offset: number, userId?: string) {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(offset) || offset < 0) {
      throw new Error("Pagination invalide");
    }
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const comments = await prisma.comment.findMany({
      where: { 
        episodeId, 
        isVisible: true,
        episode: {
          status: { in: ["PUBLISHED", "UNLISTED"] },
          podcast: { status: { in: ["PUBLISHED", "UNLISTED"] } }
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: safeLimit,
      skip: offset,
      include: {
        user: { select: { id: true, fullName: true, avatar: true, username: true } }
      }
    });

    const total = await prisma.comment.count({
      where: { 
        episodeId, 
        isVisible: true,
        episode: {
          status: { in: ["PUBLISHED", "UNLISTED"] },
          podcast: { status: { in: ["PUBLISHED", "UNLISTED"] } }
        }
      }
    });

    // Enrichir avec likes et réactions
    const enriched = comments.map((c) => {
      const likesSet = commentLikesMap.get(c.id);
      const likesCount = likesSet?.size ?? 0;
      const userLiked = userId && likesSet ? likesSet.has(userId) : false;

      const userReactions = commentReactionsMap.get(c.id);
      const reactions: Record<string, number> = {};
      if (userReactions) {
        for (const emoji of userReactions.values()) {
          reactions[emoji] = (reactions[emoji] ?? 0) + 1;
        }
      }
      const userReaction = userId && userReactions ? (userReactions.get(userId) ?? null) : null;

      return {
        ...c,
        likesCount,
        userLiked,
        reactions,
        userReaction,
      };
    });

    return { comments: enriched, total };
  }

  // --- COMMENT LIKES & REACTIONS ---
  static async likeComment(commentId: string, userId: string) {
    const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { id: true } });
    if (!comment) throw new Error("Commentaire introuvable");

    let set = commentLikesMap.get(commentId);
    if (!set) {
      set = new Set();
      commentLikesMap.set(commentId, set);
    }
    set.add(userId);

    return {
      success: true,
      commentId,
      likesCount: set.size,
      userLiked: true,
    };
  }

  static async unlikeComment(commentId: string, userId: string) {
    const set = commentLikesMap.get(commentId);
    if (set) {
      set.delete(userId);
    }

    return {
      success: true,
      commentId,
      likesCount: set?.size ?? 0,
      userLiked: false,
    };
  }

  static async reactComment(commentId: string, userId: string, emoji: string) {
    const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { id: true } });
    if (!comment) throw new Error("Commentaire introuvable");

    const validEmojis = ["❤️", "🔥", "😂", "👏", "💡", "🎙️"];
    if (!validEmojis.includes(emoji)) {
      throw new Error("Émotion non reconnue");
    }

    let userReactions = commentReactionsMap.get(commentId);
    if (!userReactions) {
      userReactions = new Map();
      commentReactionsMap.set(commentId, userReactions);
    }

    const currentEmoji = userReactions.get(userId);
    let finalEmoji: string | null = emoji;
    if (currentEmoji === emoji) {
      // Toggle off si on clique sur la même émotion
      userReactions.delete(userId);
      finalEmoji = null;
    } else {
      userReactions.set(userId, emoji);
    }

    const reactions: Record<string, number> = {};
    for (const e of userReactions.values()) {
      reactions[e] = (reactions[e] ?? 0) + 1;
    }

    return {
      success: true,
      commentId,
      reactions,
      userReaction: finalEmoji,
    };
  }

  static async deleteCommentReaction(commentId: string, userId: string) {
    const userReactions = commentReactionsMap.get(commentId);
    if (userReactions) {
      userReactions.delete(userId);
    }

    const reactions: Record<string, number> = {};
    if (userReactions) {
      for (const e of userReactions.values()) {
        reactions[e] = (reactions[e] ?? 0) + 1;
      }
    }

    return {
      success: true,
      commentId,
      reactions,
      userReaction: null,
    };
  }

  static async updateCommentSettings(episodeId: string, allowComments: boolean, userId: string) {
    if (typeof allowComments !== "boolean") throw new Error("allowComments doit être un booléen");
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: { podcastId: true }
    });
    if (!episode) throw new Error("Épisode introuvable");

    // Sécurité: vérifier si l'utilisateur est membre du podcast
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId: episode.podcastId, userId } }
    });
    const userRoles = await prisma.userRole.findMany({
      where: { userId },
      include: { role: true }
    });
    const isGlobalAdmin = userRoles.some(ur => ur.role.name === 'ADMIN');

    if (!(member && (member.role === 'OWNER' || member.role === 'ADMIN')) && !isGlobalAdmin) {
      throw new Error("Action non autorisée");
    }

    return prisma.episode.update({
      where: { id: episodeId },
      data: { allowComments }
    });
  }
}
