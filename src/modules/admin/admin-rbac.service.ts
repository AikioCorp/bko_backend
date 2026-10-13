import crypto from "crypto";
import bcrypt from "bcrypt";
import { prisma } from "../../config/prisma.js";
import { AuditService } from "../../services/audit.service.js";
import { NotificationService } from "../../services/notification.service.js";
import { Access, PermissionService } from "../../services/permission.service.js";
import { FEATURES, ROLE_TEMPLATES, SUPER_ADMIN_ROLE, isValidPermission } from "../../config/permissions.js";
import { MailService } from "../../services/mail/mail.service.js";
import { Emails } from "../../services/mail/email-templates.js";
import { hashToken } from "../auth/auth.service.js";
import { invalidateAccountStatusCache } from "../../middlewares/auth.middleware.js";

export interface Actor {
  id: string;
}

const NAME_RE = /^[A-Z][A-Z0-9_]{2,39}$/;
const subset = (a: Iterable<string>, of: Set<string>) => [...a].every((p) => of.has(p));

export class AdminRbacService {
  /** Droits de la personne connectée : sert à masquer les pages de la console. */
  static async getMyAccess(userId: string) {
    const a = await PermissionService.getAccess(userId);
    return { isSuperAdmin: a.isSuper, roles: a.roles, permissions: [...a.permissions] };
  }

  static getCatalog() {
    return { features: FEATURES, templates: ROLE_TEMPLATES };
  }

  static async listRoles() {
    const roles = await prisma.role.findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      include: { rolePermissions: { include: { permission: true } }, _count: { select: { userRoles: true } } },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      isSuperAdmin: r.name.toUpperCase() === SUPER_ADMIN_ROLE,
      usersCount: r._count.userRoles,
      permissions: r.rolePermissions.map((rp) => rp.permission.code).sort(),
    }));
  }

  private static cleanPermissions(input: string[]): string[] {
    const unique = [...new Set(input)];
    if (!unique.every(isValidPermission)) throw new Error("UNKNOWN_PERMISSION");
    return unique;
  }

  private static async permissionIds(codes: string[]) {
    const rows = await prisma.permission.findMany({ where: { code: { in: codes } } });
    if (rows.length !== codes.length) throw new Error("UNKNOWN_PERMISSION");
    return rows.map((r) => r.id);
  }

  /** Un rôle ne peut jamais accorder plus de droits que son auteur n'en possède. */
  static async createRole(actor: Actor, data: { name: string; description?: string; permissions: string[] }, ip?: string) {
    const access = await PermissionService.getAccess(actor.id);
    const name = data.name.trim().toUpperCase().replace(/[\s-]+/g, "_");
    if (!NAME_RE.test(name) || name === SUPER_ADMIN_ROLE) throw new Error("INVALID_ROLE_NAME");
    if (await prisma.role.findUnique({ where: { name } })) throw new Error("ROLE_EXISTS");

    const permissions = this.cleanPermissions(data.permissions);
    if (!access.isSuper && !subset(permissions, access.permissions)) throw new Error("PERMISSION_ESCALATION");

    const role = await prisma.role.create({
      data: {
        name,
        description: data.description?.trim() || name,
        presetApplied: true,
        rolePermissions: { create: (await this.permissionIds(permissions)).map((permissionId) => ({ permissionId })) },
      },
    });
    await AuditService.logAction({ actorId: actor.id, action: "ROLE_CREATED", entityType: "Role", entityId: role.id, newState: { name, permissions }, ipAddress: ip });
    return { id: role.id, name };
  }

  static async updateRole(actor: Actor, roleId: string, data: { description?: string; permissions: string[] }, ip?: string) {
    const access = await PermissionService.getAccess(actor.id);
    const role = await prisma.role.findUnique({ where: { id: roleId }, include: { rolePermissions: { include: { permission: true } } } });
    if (!role) throw new Error("NOT_FOUND");
    if (role.name.toUpperCase() === SUPER_ADMIN_ROLE) throw new Error("SUPER_ADMIN_LOCKED");

    const current = role.rolePermissions.map((rp) => rp.permission.code);
    const requested = this.cleanPermissions(data.permissions);

    // Droits que l'acteur ne possède pas : conservés tels quels (il ne peut ni les ajouter ni les retirer).
    let final = requested;
    if (!access.isSuper) {
      const foreignKept = current.filter((p) => !access.permissions.has(p));
      const allowedRequested = requested.filter((p) => access.permissions.has(p));
      if (requested.some((p) => !access.permissions.has(p) && !current.includes(p))) throw new Error("PERMISSION_ESCALATION");
      final = [...new Set([...foreignKept, ...allowedRequested])];
    }

    // Garde-fou : on ne peut pas se retirer à soi-même l'accès à la gestion des rôles via ce rôle.
    const mine = access.roles.includes(role.name);
    if (mine && !access.isSuper && access.permissions.has("roles.edit") && !final.includes("roles.edit")) {
      throw new Error("CANNOT_LOCK_YOURSELF_OUT");
    }

    const ids = await this.permissionIds(final);
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId } }),
      prisma.rolePermission.createMany({ data: ids.map((permissionId) => ({ roleId, permissionId })) }),
      prisma.role.update({ where: { id: roleId }, data: { ...(data.description !== undefined ? { description: data.description.trim() } : {}), presetApplied: true } }),
    ]);
    PermissionService.invalidate();
    await AuditService.logAction({
      actorId: actor.id,
      action: "ROLE_UPDATED",
      entityType: "Role",
      entityId: roleId,
      previousState: { permissions: current },
      newState: { permissions: final },
      ipAddress: ip,
    });
    return { id: roleId, permissions: final };
  }

  static async deleteRole(actor: Actor, roleId: string, ip?: string) {
    const access = await PermissionService.getAccess(actor.id);
    const role = await prisma.role.findUnique({
      where: { id: roleId },
      include: { rolePermissions: { include: { permission: true } }, _count: { select: { userRoles: true } } },
    });
    if (!role) throw new Error("NOT_FOUND");
    if (role.isSystem) throw new Error("SYSTEM_ROLE_LOCKED");
    if (role._count.userRoles > 0) throw new Error("ROLE_IN_USE");
    if (!access.isSuper && !subset(role.rolePermissions.map((rp) => rp.permission.code), access.permissions)) {
      throw new Error("PERMISSION_ESCALATION");
    }
    await prisma.role.delete({ where: { id: roleId } });
    await AuditService.logAction({ actorId: actor.id, action: "ROLE_DELETED", entityType: "Role", entityId: roleId, previousState: { name: role.name }, ipAddress: ip });
    return { id: roleId };
  }

  // ───────────── Attribution des rôles & suspension (avec garde-fous d'escalade) ─────────────

  /** L'acteur doit couvrir tous les droits de la cible, sinon il ne peut pas agir sur elle. */
  private static async assertCanActOn(access: Access, targetUserId: string) {
    if (access.isSuper) return;
    const target = await PermissionService.getAccess(targetUserId);
    if (target.isSuper || !subset(target.permissions, access.permissions)) throw new Error("FORBIDDEN");
  }

  /** Rôles qu'un acteur peut attribuer : ceux dont les droits sont inclus dans les siens. */
  static async listAssignableRoles(actorId: string) {
    const access = await PermissionService.getAccess(actorId);
    const roles = await this.listRoles();
    return roles
      .filter((r) => !r.isSuperAdmin || access.isSuper)
      .filter((r) => access.isSuper || subset(r.permissions, access.permissions))
      .map((r) => ({ id: r.id, name: r.name, description: r.description, isSystem: r.isSystem }));
  }

  static async setUserRoles(actor: Actor, userId: string, roleNames: string[], ip?: string) {
    if (actor.id === userId) throw new Error("CANNOT_EDIT_SELF");
    const access = await PermissionService.getAccess(actor.id);
    await this.assertCanActOn(access, userId);

    const wanted = [...new Set(roleNames.map((r) => r.toUpperCase()))];
    const roles = await prisma.role.findMany({ where: { name: { in: wanted } }, include: { rolePermissions: { include: { permission: true } } } });
    if (roles.length !== wanted.length) throw new Error("UNKNOWN_ROLE");

    if (!access.isSuper) {
      if (wanted.includes(SUPER_ADMIN_ROLE)) throw new Error("FORBIDDEN");
      const granted = new Set(roles.flatMap((r) => r.rolePermissions.map((rp) => rp.permission.code)));
      if (!subset(granted, access.permissions)) throw new Error("PERMISSION_ESCALATION");
    }

    const before = (await prisma.userRole.findMany({ where: { userId }, include: { role: true } })).map((r) => r.role.name);
    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId } }),
      prisma.userRole.createMany({ data: roles.map((r) => ({ userId, roleId: r.id })) }),
      // Les access tokens (15 min) portent les rôles affichés : on coupe les sessions pour appliquer le changement.
      prisma.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } }),
      prisma.session.deleteMany({ where: { userId } }),
    ]);
    PermissionService.invalidate(userId);
    await NotificationService.notify([userId], {
      type: "ROLES_CHANGED",
      title: "Vos droits d'accès ont été modifiés",
      body: "Reconnectez-vous si une page n'apparaît pas ou ne répond plus.",
    });
    await AuditService.logAction({
      actorId: actor.id,
      action: "USER_ROLES_CHANGED",
      entityType: "User",
      entityId: userId,
      previousState: { roles: before },
      newState: { roles: wanted },
      ipAddress: ip,
    });
    return { userId, roles: wanted };
  }

  static async setUserSuspension(actor: Actor, userId: string, suspended: boolean, reason?: string, ip?: string) {
    if (actor.id === userId) throw new Error("CANNOT_SUSPEND_SELF");
    const access = await PermissionService.getAccess(actor.id);
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new Error("NOT_FOUND");
    await this.assertCanActOn(access, userId);
    const finalReason = suspended ? (reason?.trim() || "Compte suspendu par l'administration") : null;

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: suspended
          ? { isSuspended: true, suspendedAt: new Date(), suspendedReason: finalReason }
          : { isSuspended: false, suspendedAt: null, suspendedReason: null },
      }),
      ...(suspended
        ? [prisma.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } }), prisma.session.deleteMany({ where: { userId } })]
        : []),
    ]);
    PermissionService.invalidate(userId);
    invalidateAccountStatusCache(userId);
    await AuditService.logAction({
      actorId: actor.id,
      action: suspended ? "USER_SUSPENDED" : "USER_REACTIVATED",
      entityType: "User",
      entityId: userId,
      newState: { suspended, reason: finalReason },
      ipAddress: ip,
    });
    return { userId, isSuspended: suspended, suspendedReason: finalReason };
  }

  static async deleteUser(actor: Actor, userId: string, ip?: string) {
    if (actor.id === userId) throw new Error("CANNOT_DELETE_SELF");
    const access = await PermissionService.getAccess(actor.id);
    const target = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: { include: { role: true } },
      },
    });
    if (!target) throw new Error("NOT_FOUND");
    await this.assertCanActOn(access, userId);

    const targetIsSuper = target.userRoles.some((ur) => ur.role.name.toUpperCase() === SUPER_ADMIN_ROLE);
    if (targetIsSuper && !access.isSuper) {
      throw new Error("FORBIDDEN");
    }

    await prisma.$transaction(async (tx) => {
      // 1. Révocation immédiate des sessions et tokens
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.session.deleteMany({ where: { userId } });

      // 2. Dissociation des uploads orphelins
      await tx.mediaAsset.updateMany({
        where: { uploaderId: userId },
        data: { uploaderId: null },
      });

      // 3. Dissociation des médias possédés
      const ownedAssets = await tx.mediaAsset.findMany({
        where: { ownerId: userId },
        select: { id: true },
      });
      if (ownedAssets.length > 0) {
        const assetIds = ownedAssets.map((a) => a.id);
        await tx.mediaSource.updateMany({
          where: { mediaAssetId: { in: assetIds } },
          data: { mediaAssetId: null },
        });
        await tx.uploadSession.updateMany({
          where: { mediaAssetId: { in: assetIds } },
          data: { mediaAssetId: null },
        });
        await tx.mediaAsset.deleteMany({
          where: { ownerId: userId },
        });
      }

      // 4. Détachement dans l'historique d'audit
      await tx.auditLog.updateMany({
        where: { actorId: userId },
        data: { actorId: null },
      });

      // 5. Détachement dans les signalements soumis
      await tx.report.updateMany({
        where: { reporterId: userId },
        data: { reporterId: null },
      });

      // 6. Suppression définitive de l'utilisateur (onDelete Cascade pour les profils, favoris, etc.)
      await tx.user.delete({
        where: { id: userId },
      });
    });

    PermissionService.invalidate(userId);

    await AuditService.logAction({
      actorId: actor.id,
      action: "USER_DELETED",
      entityType: "User",
      entityId: userId,
      previousState: { email: target.email, fullName: target.fullName },
      ipAddress: ip,
    });

    return { userId, deleted: true };
  }

  static async updateUser(
    actor: Actor,
    userId: string,
    data: {
      fullName?: string;
      email?: string;
      phoneNumber?: string | null;
      username?: string | null;
      isVerified?: boolean;
    },
    ip?: string
  ) {
    const access = await PermissionService.getAccess(actor.id);
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new Error("USER_NOT_FOUND");
    await this.assertCanActOn(access, userId);

    const updatePayload: any = {};
    if (data.fullName !== undefined) {
      const cleanName = data.fullName.trim();
      if (!cleanName) throw new Error("FULLNAME_REQUIRED");
      updatePayload.fullName = cleanName;
    }

    if (data.email !== undefined) {
      const cleanEmail = data.email.trim().toLowerCase();
      if (!cleanEmail || !cleanEmail.includes("@")) throw new Error("INVALID_EMAIL");
      if (cleanEmail !== target.email.toLowerCase()) {
        const existing = await prisma.user.findFirst({
          where: { email: { equals: cleanEmail, mode: "insensitive" }, id: { not: userId } },
        });
        if (existing) throw new Error("EMAIL_ALREADY_EXISTS");
        updatePayload.email = cleanEmail;
      }
    }

    if (data.phoneNumber !== undefined) {
      const cleanPhone = data.phoneNumber?.trim() || null;
      if (cleanPhone && cleanPhone !== target.phoneNumber) {
        const existingPhone = await prisma.user.findFirst({
          where: { phoneNumber: cleanPhone, id: { not: userId } },
        });
        if (existingPhone) throw new Error("PHONE_ALREADY_EXISTS");
      }
      updatePayload.phoneNumber = cleanPhone;
    }

    if (data.username !== undefined) {
      const cleanUsername = data.username?.trim().toLowerCase() || null;
      if (cleanUsername && cleanUsername !== target.username?.toLowerCase()) {
        const existingUsername = await prisma.user.findFirst({
          where: { username: { equals: cleanUsername, mode: "insensitive" }, id: { not: userId } },
        });
        if (existingUsername) throw new Error("USERNAME_ALREADY_EXISTS");
      }
      updatePayload.username = cleanUsername;
    }

    if (data.isVerified !== undefined) {
      updatePayload.isVerified = Boolean(data.isVerified);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updatePayload,
      select: {
        id: true,
        email: true,
        fullName: true,
        username: true,
        phoneNumber: true,
        isVerified: true,
        isSuspended: true,
        updatedAt: true,
      },
    });

    await AuditService.logAction({
      actorId: actor.id,
      action: "USER_UPDATED",
      entityType: "User",
      entityId: userId,
      previousState: {
        fullName: target.fullName,
        email: target.email,
        phoneNumber: target.phoneNumber,
        username: target.username,
        isVerified: target.isVerified,
      },
      newState: updatePayload,
      ipAddress: ip,
    });

    return updatedUser;
  }

  static async adminResetPassword(
    actor: Actor,
    userId: string,
    params: {
      mode: "DIRECT" | "GENERATE" | "SEND_EMAIL";
      password?: string;
      revokeSessions?: boolean;
      notifyUser?: boolean;
    },
    ip?: string
  ) {
    const access = await PermissionService.getAccess(actor.id);
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new Error("USER_NOT_FOUND");
    await this.assertCanActOn(access, userId);

    const revokeSessions = params.revokeSessions !== false; // true par défaut
    const notifyUser = params.notifyUser !== false; // true par défaut

    if (params.mode === "SEND_EMAIL") {
      // Générer OTP 6 chiffres + enregistrer hash + envoyer email
      const otpCode = crypto.randomInt(100000, 1000000).toString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await prisma.user.update({
        where: { id: userId },
        data: {
          passwordResetToken: hashToken(otpCode),
          passwordResetExpiresAt: expiresAt,
        },
      });

      void MailService.sendNow(await Emails.resetPassword(target.email, otpCode, target.fullName));

      await AuditService.logAction({
        actorId: actor.id,
        action: "USER_PASSWORD_RESET_LINK_SENT",
        entityType: "User",
        entityId: userId,
        ipAddress: ip,
      });

      return {
        success: true,
        mode: "SEND_EMAIL",
        message: `Un code OTP et un lien de réinitialisation ont été envoyés à ${target.email}.`,
      };
    }

    let rawPassword = "";
    if (params.mode === "GENERATE") {
      const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*";
      let pwd = "";
      for (let i = 0; i < 12; i++) {
        pwd += chars.charAt(crypto.randomInt(0, chars.length));
      }
      rawPassword = `Bko#${pwd}`;
    } else if (params.mode === "DIRECT") {
      rawPassword = String(params.password || "");
      if (rawPassword.length < 8 || rawPassword.length > 72) {
        throw new Error("PASSWORD_INVALID_LENGTH");
      }
    } else {
      throw new Error("INVALID_RESET_MODE");
    }

    const passwordHash = await bcrypt.hash(rawPassword, 10);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          passwordResetToken: null,
          passwordResetExpiresAt: null,
          isVerified: true,
        },
      }),
      ...(revokeSessions
        ? [
            prisma.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } }),
            prisma.session.deleteMany({ where: { userId } }),
          ]
        : []),
    ]);

    if (notifyUser) {
      await NotificationService.notify(
        [userId],
        {
          type: "PASSWORD_CHANGED",
          title: "Votre mot de passe a été réinitialisé",
          body: "Votre mot de passe a été réinitialisé par un administrateur. Si vous n'êtes pas à l'origine de cette demande, contactez immédiatement le support.",
        },
        { email: true }
      );
    }

    await AuditService.logAction({
      actorId: actor.id,
      action: "USER_PASSWORD_RESET",
      entityType: "User",
      entityId: userId,
      newState: { mode: params.mode, revokeSessions, notifyUser },
      ipAddress: ip,
    });

    return {
      success: true,
      mode: params.mode,
      generatedPassword: params.mode === "GENERATE" ? rawPassword : undefined,
      message: params.mode === "GENERATE"
        ? "Mot de passe généré et appliqué avec succès."
        : "Nouveau mot de passe enregistré avec succès.",
      revokedSessions: revokeSessions,
    };
  }
}
