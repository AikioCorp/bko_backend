import crypto from "crypto";
import { prisma } from "../../config/prisma.js";
import { hashToken } from "../auth/auth.service.js";
import { PodcastMemberRole } from "@prisma/client";
import { MailService } from "../../services/mail/mail.service.js";
import { Emails } from "../../services/mail/email-templates.js";
import { NotificationService } from "../../services/notification.service.js";
import { AuditService } from "../../services/audit.service.js";

const ROLE_LABELS: Record<string, string> = { OWNER: "propriétaire", ADMIN: "administrateur", EDITOR: "éditeur", ANALYST: "analyste" };

export class PodcastTeamService {
  /** Recherche d'utilisateurs existants pour ajout direct à une équipe */
  static async searchUsers(query: string) {
    const q = (query || "").trim();
    if (q.length < 2) return [];
    return prisma.user.findMany({
      where: {
        isSuspended: false,
        OR: [
          { fullName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phoneNumber: { contains: q } },
        ],
      },
      take: 10,
      select: {
        id: true,
        fullName: true,
        email: true,
        avatar: true,
        phoneNumber: true,
      },
      orderBy: { fullName: "asc" },
    });
  }

  /**
   * Ajout direct d'un utilisateur existant à l'équipe d'un podcast (RÈGLE MÉTIER PRIORITAIRE).
   * L'appartenance et les droits deviennent actifs immédiatement. Aucune acceptation ni jeton n'est requis.
   */
  static async directAddMember(
    actorUserId: string,
    podcastId: string,
    input: { userId?: string; email?: string; role: PodcastMemberRole },
    isStaffAdmin: boolean = false,
    ip?: string
  ) {
    // 1. Contrôle des droits de l'acteur
    if (!isStaffAdmin) {
      const mine = await this.myRole(actorUserId, podcastId);
      if (mine !== "OWNER") throw new Error("FORBIDDEN");
    }

    // 2. Validation du rôle
    const validRoles: PodcastMemberRole[] = ["OWNER", "ADMIN", "EDITOR", "ANALYST"];
    if (!validRoles.includes(input.role)) {
      throw new Error("FORBIDDEN");
    }

    // 3. Résolution de l'utilisateur cible (par id ou par email)
    let targetUser = null;
    if (input.userId) {
      targetUser = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, fullName: true, email: true, avatar: true, isSuspended: true },
      });
    } else if (input.email) {
      const normalizedEmail = input.email.trim().toLowerCase();
      targetUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, fullName: true, email: true, avatar: true, isSuspended: true },
      });
    }

    if (!targetUser) {
      throw new Error("USER_NOT_FOUND");
    }
    if (targetUser.isSuspended) {
      throw new Error("USER_SUSPENDED");
    }

    // 4. Vérification de l'état existant (idempotence stricte et protection contre réécriture silencieuse)
    const existing = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId, userId: targetUser.id } },
      include: {
        user: { select: { id: true, fullName: true, email: true, avatar: true } },
      },
    });

    if (existing) {
      if (existing.role === input.role) {
        return {
          success: true,
          alreadyMember: true,
          member: existing,
          message: `${targetUser.fullName} fait déjà partie de l'équipe avec le rôle ${ROLE_LABELS[existing.role]}.`,
        };
      }
      throw new Error("MEMBER_ALREADY_EXISTS_WITH_ROLE");
    }

    // 5. Création effective et immédiate de l'appartenance
    const newMember = await prisma.podcastMember.create({
      data: {
        podcastId,
        userId: targetUser.id,
        role: input.role,
      },
      include: {
        user: { select: { id: true, fullName: true, email: true, avatar: true } },
        podcast: { select: { id: true, name: true, slug: true } },
      },
    });

    // 6. Journalisation d'audit
    await AuditService.logAction({
      actorId: actorUserId,
      action: "PODCAST_MEMBER_DIRECT_ADDED",
      entityType: "Podcast",
      entityId: podcastId,
      newState: {
        targetUserId: targetUser.id,
        targetEmail: targetUser.email,
        role: input.role,
        addedByStaff: isStaffAdmin,
      },
      ipAddress: ip,
    });

    // 7. Notification de bout en bout (in-app, push et email avec bouton « Ouvrir l’émission »)
    await NotificationService.notify(
      [targetUser.id],
      {
        type: "TEAM_MEMBER_ADDED",
        title: `Vous avez été ajouté à l'équipe : ${newMember.podcast.name}`,
        body: `Vous êtes maintenant ${ROLE_LABELS[input.role]} de ce podcast. Votre accès au Studio est immédiatement actif.`,
        link: `/studio/podcasts/${podcastId}`,
        actionLabel: "Ouvrir l’émission",
      },
      { email: true }
    );

    return {
      success: true,
      alreadyMember: false,
      member: newMember,
      message: `${targetUser.fullName} a été ajouté(e) directement à l'équipe en tant que ${ROLE_LABELS[input.role]}.`,
    };
  }

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

  private static async myRole(userId: string, podcastId: string) {
    const m = await prisma.podcastMember.findUnique({ where: { podcastId_userId: { podcastId, userId } } });
    if (!m) throw new Error("FORBIDDEN");
    return m.role;
  }

  private static async ownersCount(podcastId: string) {
    return prisma.podcastMember.count({ where: { podcastId, role: "OWNER" } });
  }

  /** Change le rôle d'un membre. Seul un OWNER touche aux rôles OWNER/ADMIN ; on garde toujours un OWNER. */
  static async updateMemberRole(userId: string, podcastId: string, targetUserId: string, role: PodcastMemberRole) {
    const mine = await this.myRole(userId, podcastId);
    if (mine !== "OWNER" && mine !== "ADMIN") throw new Error("FORBIDDEN");
    if (userId === targetUserId) throw new Error("CANNOT_EDIT_SELF");

    const target = await prisma.podcastMember.findUnique({ where: { podcastId_userId: { podcastId, userId: targetUserId } } });
    if (!target) throw new Error("MEMBER_NOT_FOUND");
    const elevated = (r: PodcastMemberRole) => r === "OWNER" || r === "ADMIN";
    if ((elevated(role) || elevated(target.role)) && mine !== "OWNER") throw new Error("FORBIDDEN");
    if (target.role === "OWNER" && role !== "OWNER" && (await this.ownersCount(podcastId)) <= 1) throw new Error("CANNOT_REMOVE_OWNER");

    const updated = await prisma.podcastMember.update({
      where: { podcastId_userId: { podcastId, userId: targetUserId } },
      data: { role },
      include: { user: { select: { id: true, fullName: true, email: true, avatar: true } }, podcast: { select: { name: true } } },
    });
    await NotificationService.notify([targetUserId], {
      type: "TEAM_ROLE_CHANGED",
      title: `Votre rôle a changé : ${updated.podcast.name}`,
      body: `Vous êtes maintenant ${ROLE_LABELS[role]} de ce podcast.`,
      link: `/studio/podcasts/${podcastId}`,
    });
    return updated;
  }

  /** Retire un membre, ou permet à un membre de quitter l'équipe (targetUserId = soi-même). */
  static async removeMember(userId: string, podcastId: string, targetUserId: string) {
    const mine = await this.myRole(userId, podcastId);
    const target = await prisma.podcastMember.findUnique({ where: { podcastId_userId: { podcastId, userId: targetUserId } } });
    if (!target) throw new Error("MEMBER_NOT_FOUND");

    if (userId !== targetUserId) {
      if (mine !== "OWNER" && mine !== "ADMIN") throw new Error("FORBIDDEN");
      // Un ADMIN ne peut retirer ni un OWNER ni un autre ADMIN.
      if (mine === "ADMIN" && (target.role === "OWNER" || target.role === "ADMIN")) throw new Error("FORBIDDEN");
    }
    if (target.role === "OWNER" && (await this.ownersCount(podcastId)) <= 1) throw new Error("CANNOT_REMOVE_OWNER");

    await prisma.podcastMember.delete({ where: { podcastId_userId: { podcastId, userId: targetUserId } } });
    if (userId !== targetUserId) {
      const podcast = await prisma.podcast.findUnique({ where: { id: podcastId }, select: { name: true } });
      await NotificationService.notify([targetUserId], {
        type: "TEAM_REMOVED",
        title: `Vous ne faites plus partie de l'équipe : ${podcast?.name ?? "podcast"}`,
        link: "/studio",
      });
    }
    return { message: userId === targetUserId ? "Vous avez quitté l'équipe" : "Membre retiré de l'équipe" };
  }

  static async listInvitations(userId: string, podcastId: string) {
    const mine = await this.myRole(userId, podcastId);
    if (mine !== "OWNER" && mine !== "ADMIN") throw new Error("FORBIDDEN");
    return prisma.podcastInvitation.findMany({
      where: { podcastId, status: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    });
  }

  static async revokeInvitation(userId: string, podcastId: string, invitationId: string) {
    const mine = await this.myRole(userId, podcastId);
    if (mine !== "OWNER" && mine !== "ADMIN") throw new Error("FORBIDDEN");
    const inv = await prisma.podcastInvitation.findUnique({ where: { id: invitationId } });
    if (!inv || inv.podcastId !== podcastId) throw new Error("INVITATION_NOT_FOUND");
    await prisma.podcastInvitation.update({ where: { id: invitationId }, data: { status: "REVOKED" } });
    return { id: invitationId };
  }

  /** La personne invitée (compte dont l'email correspond) rejoint l'équipe avec le rôle prévu. */
  static async acceptInvitation(userId: string, rawToken: string) {
    const inv = await prisma.podcastInvitation.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (!inv || inv.status !== "PENDING") throw new Error("INVITATION_INVALID");
    if (inv.expiresAt < new Date()) throw new Error("INVITATION_INVALID");

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.email.toLowerCase() !== inv.email.toLowerCase()) throw new Error("INVITATION_EMAIL_MISMATCH");

    const existing = await prisma.podcastMember.findUnique({ where: { podcastId_userId: { podcastId: inv.podcastId, userId } } });
    await prisma.$transaction([
      // Jamais de rétrogradation d'un membre existant via une invitation.
      ...(existing ? [] : [prisma.podcastMember.create({ data: { podcastId: inv.podcastId, userId, role: inv.role } })]),
      prisma.podcastInvitation.update({ where: { id: inv.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } }),
    ]);
    await NotificationService.notify([inv.invitedById], {
      type: "INVITATION_ACCEPTED",
      title: `${user.fullName} a rejoint l'équipe`,
      body: `Rôle : ${ROLE_LABELS[existing?.role ?? inv.role]}.`,
      link: `/studio/podcasts/${inv.podcastId}`,
    });
    return { podcastId: inv.podcastId, role: existing?.role ?? inv.role };
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

    // Anti-escalade : rôle valide, et seul un OWNER peut attribuer OWNER/ADMIN.
    if (!["OWNER", "ADMIN", "EDITOR", "ANALYST"].includes(role as string)) {
      throw new Error("FORBIDDEN");
    }
    if ((role === "OWNER" || role === "ADMIN") && currentMember.role !== "OWNER") {
      throw new Error("FORBIDDEN");
    }

    const normalizedEmail = email.trim().toLowerCase();
    // Une seule invitation en cours par adresse : l'ancienne est remplacée.
    await prisma.podcastInvitation.updateMany({
      where: { podcastId, email: normalizedEmail, status: "PENDING" },
      data: { status: "REVOKED" },
    });

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = await prisma.podcastInvitation.create({
      data: {
        podcastId,
        email: normalizedEmail,
        role,
        tokenHash,
        expiresAt,
        invitedById: userId,
        status: "PENDING",
      },
    });

    // Email d'invitation (immédiat : il porte le lien secret, rien n'est conservé en base).
    const [podcast, inviter] = await Promise.all([
      prisma.podcast.findUnique({ where: { id: podcastId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
    ]);
    const emailSent = await MailService.sendNow(
      Emails.invitation(normalizedEmail, {
        podcastName: podcast?.name ?? "un podcast",
        inviterName: inviter?.fullName ?? "Un membre de l'équipe",
        roleLabel: ROLE_LABELS[role] ?? "membre",
        token: rawToken,
      })
    );

    return {
      invitationId: invitation.id,
      email: invitation.email,
      role: invitation.role,
      emailSent,
      invitationToken: rawToken, // Repli : lien à copier si l'email n'a pas pu partir
    };
  }
}
