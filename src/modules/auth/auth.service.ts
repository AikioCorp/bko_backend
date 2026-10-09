import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/prisma.js";
import { JWT_SECRET } from "../../config/jwt.js";
import { FeatureFlags } from "../../config/feature-flags.js";
import { MailService } from "../../services/mail/mail.service.js";
import { Emails } from "../../services/mail/email-templates.js";
import { NotificationService } from "../../services/notification.service.js";

const BCRYPT_ROUNDS = 12;

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export class AuthService {
  static async register(params: {
    email: string;
    password: string;
    fullName: string;
    phoneNumber?: string;
  }) {
    const { email, password, fullName, phoneNumber } = params;

    // Réponse générique volontairement identique que le compte existe ou non
    // (anti-énumération : on ne révèle jamais si un email/téléphone est déjà inscrit).
    const genericMessage = "Si ces informations sont valides, un code de vérification a été envoyé.";
    const otpCode = crypto.randomInt(100000, 1000000).toString(); // OTP 6 chiffres cryptographiquement sûr
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // Expiration 15 min

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, ...(phoneNumber ? [{ phoneNumber }] : [])],
      },
    });

    if (existingUser) {
      // Compte non vérifié : on régénère un OTP (renvoi). Compte déjà vérifié : on ne fait
      // rien. Dans les deux cas, la réponse renvoyée est strictement identique.
      if (!existingUser.isVerified) {
        await prisma.user.update({
          where: { id: existingUser.id },
          data: { otpCode: hashToken(otpCode), otpExpiresAt },
        });
        // Envoi sans attendre : le temps de réponse ne doit pas révéler si le compte existe.
        void MailService.sendNow(Emails.otp(existingUser.email, otpCode));
        return { email, message: genericMessage, ...(process.env.NODE_ENV === "development" ? { otpCode } : {}) };
      }
      return { email, message: genericMessage };
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const roleUser = await prisma.role.findUnique({ where: { name: "USER" } });

    await prisma.user.create({
      data: {
        email,
        phoneNumber,
        fullName,
        passwordHash,
        isVerified: true,
        otpCode: hashToken(otpCode), // OTP stocké haché, jamais en clair
        otpExpiresAt,
        ...(roleUser
          ? {
              userRoles: {
                create: {
                  roleId: roleUser.id,
                },
              },
            }
          : {}),
      },
    });

    void MailService.sendNow(Emails.otp(email, otpCode));
    return {
      email,
      message: genericMessage,
      ...(process.env.NODE_ENV === "development" ? { otpCode } : {}),
    };
  }

  /** Demande de réinitialisation : réponse identique que le compte existe ou non (anti-énumération). */
  static async forgotPassword(email: string) {
    const user = await prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" } } });
    if (user && user.passwordHash && !user.isSuspended) {
      const token = crypto.randomBytes(32).toString("hex");
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordResetToken: hashToken(token), passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      });
      void MailService.sendNow(Emails.resetPassword(user.email, token));
    }
    return { message: "Si un compte correspond à cette adresse, un email de réinitialisation vient d'être envoyé." };
  }

  static async resetPassword(token: string, newPassword: string) {
    const user = await prisma.user.findFirst({
      where: { passwordResetToken: hashToken(token), passwordResetExpiresAt: { gt: new Date() } },
    });
    if (!user) throw new Error("RESET_TOKEN_INVALID");

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, passwordResetToken: null, passwordResetExpiresAt: null },
      }),
      // Toutes les sessions existantes sont coupées : un éventuel intrus perd son accès.
      prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { isRevoked: true } }),
      prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);
    await NotificationService.notify(
      [user.id],
      { type: "PASSWORD_CHANGED", title: "Votre mot de passe a été modifié", body: "Si ce n'était pas vous, réinitialisez-le immédiatement et contactez le support." },
      { email: true }
    );
    return { message: "Mot de passe modifié. Vous pouvez vous connecter." };
  }

  static async verifyOtp(params: { email: string; otpCode: string }) {
    const user = await prisma.user.findUnique({ where: { email: params.email } });

    if (!user || !user.otpCode || user.otpCode !== hashToken(params.otpCode)) {
      throw new Error("INVALID_CREDENTIALS");
    }

    if (user.otpExpiresAt && user.otpExpiresAt < new Date()) {
      throw new Error("RESET_TOKEN_EXPIRED");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        otpCode: null,
        otpExpiresAt: null,
      },
    });

    return { message: "Compte vérifié avec succès" };
  }

  static async login(params: {
    identifier: string; // Email, Username ou Téléphone
    password: string;
    deviceType?: string;
    deviceName?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const input = params.identifier.trim();
    const phoneVariants = [input];
    if (!input.startsWith("+")) {
      phoneVariants.push(`+223${input}`);
    } else if (input.startsWith("+223")) {
      phoneVariants.push(input.replace("+223", ""));
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: input, mode: "insensitive" } },
          { username: { equals: input, mode: "insensitive" } },
          { phoneNumber: { in: phoneVariants } },
        ],
      },
      include: {
        userRoles: {
          include: { role: true },
        },
      },
    });

    if (!user || !user.passwordHash) {
      throw new Error("INVALID_CREDENTIALS");
    }

    const isMatch = await bcrypt.compare(params.password, user.passwordHash);
    if (!isMatch) {
      throw new Error("INVALID_CREDENTIALS");
    }

    if (user.isSuspended) {
      throw new Error("INVALID_CREDENTIALS");
    }

    // Le compte doit avoir été vérifié par OTP avant de pouvoir se connecter
    // (uniquement si la fonctionnalité est activée — cf. FeatureFlags.requireVerifiedLogin).
    if (FeatureFlags.requireVerifiedLogin && !user.isVerified) {
      throw new Error("ACCOUNT_NOT_VERIFIED");
    }

    const roles = user.userRoles.map((ur) => ur.role.name);

    // Générer Access Token (15m)
    const accessToken = jwt.sign(
      { id: user.id, email: user.email, roles },
      JWT_SECRET,
      { expiresIn: "15m" }
    );

    // Générer Refresh Token (7 jours)
    const rawRefreshToken = crypto.randomBytes(40).toString("hex");
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Créer ou enregistrer l'appareil
    let device = null;
    if (params.deviceType) {
      device = await prisma.device.create({
        data: {
          userId: user.id,
          deviceType: params.deviceType || "WEB",
          deviceName: params.deviceName || "Appareil Navigateur",
        },
      });
    }

    // Créer la Session & le RefreshToken en base (Hachés)
    await Promise.all([
      prisma.session.create({
        data: {
          userId: user.id,
          deviceId: device?.id,
          tokenHash: tokenHash,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          expiresAt,
        },
      }),
      prisma.refreshToken.create({
        data: {
          userId: user.id,
          deviceId: device?.id,
          tokenHash: tokenHash,
          expiresAt,
        },
      }),
    ]);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatar: user.avatar,
        roles,
      },
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  static async refreshToken(rawRefreshToken: string) {
    const tokenHash = hashToken(rawRefreshToken);

    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            userRoles: { include: { role: true } },
          },
        },
      },
    });

    if (!storedToken) {
      throw new Error("INVALID_REFRESH_TOKEN");
    }

    // Rejeu d'un token DÉJÀ révoqué (donc déjà utilisé) : signal probable de vol de token.
    // On invalide toute la famille de sessions de l'utilisateur par précaution.
    if (storedToken.isRevoked) {
      await AuthService.logoutAllDevices(storedToken.userId);
      throw new Error("INVALID_REFRESH_TOKEN");
    }

    if (storedToken.expiresAt < new Date() || storedToken.user.isSuspended) {
      throw new Error("INVALID_REFRESH_TOKEN");
    }

    // Révocation de l'ancien token (Rotation)
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true },
    });

    // Génération du nouveau duo de tokens
    const roles = storedToken.user.userRoles.map((ur) => ur.role.name);
    const newAccessToken = jwt.sign(
      { id: storedToken.user.id, email: storedToken.user.email, roles },
      JWT_SECRET,
      { expiresIn: "15m" }
    );

    const newRawRefreshToken = crypto.randomBytes(40).toString("hex");
    const newHash = hashToken(newRawRefreshToken);
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: {
        userId: storedToken.userId,
        deviceId: storedToken.deviceId,
        tokenHash: newHash,
        expiresAt: newExpiresAt,
      },
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken,
    };
  }

  static async logout(rawRefreshToken: string) {
    const tokenHash = hashToken(rawRefreshToken);

    await prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { isRevoked: true },
    });

    await prisma.session.deleteMany({
      where: { tokenHash },
    });

    return { message: "Déconnexion réussie" };
  }

  static async logoutAllDevices(userId: string) {
    await Promise.all([
      prisma.refreshToken.updateMany({
        where: { userId },
        data: { isRevoked: true },
      }),
      prisma.session.deleteMany({
        where: { userId },
      }),
    ]);

    return { message: "Déconnexion de tous les appareils réussie" };
  }
}
