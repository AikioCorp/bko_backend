import crypto from "crypto";
import { prisma } from "../../config/prisma.js";
import { hashToken } from "../auth/auth.service.js";
import { PodcastMemberRole } from "@prisma/client";

export class PodcastTeamService {
  static async getMembers(userId: string, podcastId: string) {
    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });
    if (!member) throw new Error("FORBIDDEN");

    return prisma.podcastMember.findMany({
      where: { podcastId },
      include: {
        user: { select: { id: true, fullName: true, email: true, avatar: true } },
      },
    });
  }

  static async addOrUpdateMember(
    userId: string,
    podcastId: string,
    targetUserId: string,
    role: PodcastMemberRole
  ) {
    const currentMember = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });

    if (!currentMember || (currentMember.role !== "OWNER" && currentMember.role !== "ADMIN")) {
      throw new Error("FORBIDDEN");
    }

    return prisma.podcastMember.upsert({
      where: { podcastId_userId: { podcastId, userId: targetUserId } },
      update: { role },
      create: { podcastId, userId: targetUserId, role },
      include: { user: { select: { id: true, fullName: true, email: true, avatar: true } } },
    });
  }

  static async removeMember(userId: string, podcastId: string, targetUserId: string) {
    const currentMember = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });

    if (!currentMember || (currentMember.role !== "OWNER" && currentMember.role !== "ADMIN")) {
      throw new Error("FORBIDDEN");
    }

    // Empêcher la suppression du seul OWNER
    const targetMember = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId: targetUserId } },
    });
    if (targetMember?.role === "OWNER") {
      throw new Error("CANNOT_REMOVE_OWNER");
    }

    await prisma.podcastMember.delete({
      where: { podcastId_userId: { podcastId, userId: targetUserId } },
    });

    return { message: "Membre retiré de l'équipe" };
  }

  static async createInvitation(
    userId: string,
    podcastId: string,
    email: string,
    role: PodcastMemberRole
  ) {
    const currentMember = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId } },
    });

    if (!currentMember || (currentMember.role !== "OWNER" && currentMember.role !== "ADMIN")) {
      throw new Error("FORBIDDEN");
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = await prisma.podcastInvitation.create({
      data: {
        podcastId,
        email,
        role,
        tokenHash,
        expiresAt,
        invitedById: userId,
        status: "PENDING",
      },
    });

    return {
      invitationId: invitation.id,
      email: invitation.email,
      role: invitation.role,
      invitationToken: rawToken, // À envoyer par email
    };
  }
}
