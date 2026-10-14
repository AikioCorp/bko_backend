import { prisma } from "../../config/prisma.js";
import { UserProfileService } from "../recommendations/user-profile.service.js";

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

  // --- COMMENTS & REPLIES (TIKTOK / FACEBOOK THREADED STRUCTURE) ---
  static async createComment(episodeId: string, userId: string, text: string, parentId?: string) {
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

    let validParentId: string | null = null;
    if (parentId && typeof parentId === "string" && parentId.trim().length > 0) {
      const parent = await prisma.comment.findUnique({
        where: { id: parentId },
        select: { id: true, episodeId: true, isVisible: true, parentId: true }
      });
      if (!parent || parent.episodeId !== episodeId || !parent.isVisible) {
        throw new Error("Commentaire parent introuvable");
      }
      // Rattachement propre (structure 1-niveau élégante style TikTok / Facebook)
      validParentId = parent.parentId ? parent.parentId : parent.id;
    }

    const created = await prisma.comment.create({
      data: {
        episodeId,
        userId,
        text: cleanText,
        parentId: validParentId,
      },
      include: {
        user: {
          select: { id: true, fullName: true, avatar: true, username: true }
        }
      }
    });

    return {
      ...created,
      likesCount: 0,
      userLiked: false,
      reactions: {} as Record<string, number>,
      userReaction: null as string | null,
      repliesCount: 0,
      replies: []
    };
  }

  static async deleteComment(commentId: string, userId: string) {
    const comment = await prisma.comment.findUnique({ 
      where: { id: commentId },
      include: { episode: { select: { podcastId: true } } }
    });
    if (!comment) throw new Error("Commentaire introuvable");

    if (comment.userId === userId) {
      // L'auteur peut supprimer son commentaire ou sa réponse
      await prisma.comment.delete({ where: { id: commentId } });
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

    // Récupérer les commentaires racines (parentId = null) avec leurs réponses imbriquées
    const comments = await prisma.comment.findMany({
      where: { 
        episodeId, 
        isVisible: true,
        parentId: null,
        episode: {
          status: { in: ["PUBLISHED", "UNLISTED"] },
          podcast: { status: { in: ["PUBLISHED", "UNLISTED"] } }
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: safeLimit,
      skip: offset,
      include: {
        user: { select: { id: true, fullName: true, avatar: true, username: true } },
        likes: { select: { userId: true } },
        reactions: { select: { userId: true, emoji: true } },
        replies: {
          where: { isVisible: true },
          orderBy: { createdAt: "asc" },
          include: {
            user: { select: { id: true, fullName: true, avatar: true, username: true } },
            likes: { select: { userId: true } },
            reactions: { select: { userId: true, emoji: true } }
          }
        }
      }
    });

    const total = await prisma.comment.count({
      where: { 
        episodeId, 
        isVisible: true,
        parentId: null,
        episode: {
          status: { in: ["PUBLISHED", "UNLISTED"] },
          podcast: { status: { in: ["PUBLISHED", "UNLISTED"] } }
        }
      }
    });

    // Helper pour formater likes & réactions sur un commentaire ou une réponse
    const formatReactionsAndLikes = (item: any) => {
      const likesCount = item.likes ? item.likes.length : 0;
      const userLiked = userId && item.likes ? item.likes.some((l: any) => l.userId === userId) : false;

      const reactions: Record<string, number> = {};
      let userReaction: string | null = null;
      if (item.reactions) {
        for (const r of item.reactions) {
          reactions[r.emoji] = (reactions[r.emoji] ?? 0) + 1;
          if (userId && r.userId === userId) {
            userReaction = r.emoji;
          }
        }
      }

      return { likesCount, userLiked, reactions, userReaction };
    };

    const enriched = comments.map((c) => {
      const rootMeta = formatReactionsAndLikes(c);
      const replies = (c.replies || []).map((rep) => {
        const repMeta = formatReactionsAndLikes(rep);
        const { likes, reactions: _r, ...cleanRep } = rep;
        return {
          ...cleanRep,
          ...repMeta,
        };
      });

      const { likes, reactions: _r, replies: _rep, ...cleanRoot } = c;
      return {
        ...cleanRoot,
        ...rootMeta,
        repliesCount: replies.length,
        replies,
      };
    });

    return { comments: enriched, total };
  }

  // --- COMMENT LIKES (PERSISTÉS EN BASE, AUTEUR AUTORISÉ) ---
  static async likeComment(commentId: string, userId: string) {
    const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { id: true } });
    if (!comment) throw new Error("Commentaire introuvable");

    await prisma.commentLike.upsert({
      where: { commentId_userId: { commentId, userId } },
      update: {},
      create: { commentId, userId }
    });

    const likesCount = await prisma.commentLike.count({ where: { commentId } });

    return {
      success: true,
      commentId,
      likesCount,
      userLiked: true,
    };
  }

  static async unlikeComment(commentId: string, userId: string) {
    await prisma.commentLike.deleteMany({
      where: { commentId, userId }
    });

    const likesCount = await prisma.commentLike.count({ where: { commentId } });

    return {
      success: true,
      commentId,
      likesCount,
      userLiked: false,
    };
  }

  // --- WHATSAPP-STYLE REACTIONS (PERSISTÉES EN BASE, AUTEUR AUTORISÉ) ---
  static async reactComment(commentId: string, userId: string, emoji: string) {
    const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { id: true } });
    if (!comment) throw new Error("Commentaire introuvable");

    if (!emoji || typeof emoji !== "string" || emoji.trim().length === 0 || emoji.length > 8) {
      throw new Error("Émotion non reconnue");
    }
    const cleanEmoji = emoji.trim();

    const existing = await prisma.commentReaction.findUnique({
      where: { commentId_userId: { commentId, userId } }
    });

    let finalEmoji: string | null = cleanEmoji;
    if (existing && existing.emoji === cleanEmoji) {
      // Toggle off si on clique sur la même émotion (comportement WhatsApp)
      await prisma.commentReaction.delete({
        where: { commentId_userId: { commentId, userId } }
      });
      finalEmoji = null;
    } else {
      await prisma.commentReaction.upsert({
        where: { commentId_userId: { commentId, userId } },
        update: { emoji: cleanEmoji },
        create: { commentId, userId, emoji: cleanEmoji }
      });
    }

    const allReactions = await prisma.commentReaction.findMany({
      where: { commentId },
      select: { emoji: true }
    });
    const reactions: Record<string, number> = {};
    for (const r of allReactions) {
      reactions[r.emoji] = (reactions[r.emoji] ?? 0) + 1;
    }

    return {
      success: true,
      commentId,
      reactions,
      userReaction: finalEmoji,
    };
  }

  static async deleteCommentReaction(commentId: string, userId: string) {
    await prisma.commentReaction.deleteMany({
      where: { commentId, userId }
    });

    const allReactions = await prisma.commentReaction.findMany({
      where: { commentId },
      select: { emoji: true }
    });
    const reactions: Record<string, number> = {};
    for (const r of allReactions) {
      reactions[r.emoji] = (reactions[r.emoji] ?? 0) + 1;
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
