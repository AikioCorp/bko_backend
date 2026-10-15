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

export class AccountSuspendedError extends Error {
  code = "ACCOUNT_SUSPENDED";
  details: {
    reason: string;
    isPermanent: boolean;
    suspendedAt?: string;
  };

  constructor(reason?: string | null, suspendedAt?: Date | null) {
    super(reason || "Votre compte a été suspendu par l'administration.");
    this.name = "AccountSuspendedError";
    this.details = {
      reason: reason || "Votre compte a été suspendu par l'administration.",
      isPermanent: true,
      suspendedAt: suspendedAt ? suspendedAt.toISOString() : undefined,
    };
  }
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function isOtpTestMode(): boolean {
  if (process.env.AUTH_OTP_MODE === "test" || process.env.NODE_ENV === "test") return true;
  if (process.env.AUTH_OTP_MODE === "email") return false;
  return process.env.ENABLE_DEV_OTP === "true" || process.env.NODE_ENV !== "production";
}

export function resolveTokenLifetime(deviceType?: string | null): { accessExpiresIn: jwt.SignOptions["expiresIn"]; refreshExpiresInDays: number } {
  const norm = String(deviceType || "").toUpperCase();
  const isMobile = norm.includes("MOBILE") || norm.includes("ANDROID") || norm.includes("IOS");
  if (isMobile) {
    return {
      accessExpiresIn: (process.env.JWT_MOBILE_ACCESS_EXPIRES_IN as any) || "30d",
      refreshExpiresInDays: 90,
    };
  }
  return {
    accessExpiresIn: (process.env.JWT_ACCESS_EXPIRES_IN as any) || "7d",
    refreshExpiresInDays: 30,
  };
}

export class AuthService {
  static async register(params: {
    email: string;
    password: string;
    fullName: string;
    phoneNumber?: string;
  }) {
    const { email, password, fullName, phoneNumber } = params;
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = phoneNumber?.trim() || null;
    const isTestMode = isOtpTestMode();
    const otpCode = crypto.randomInt(100000, 1000000).toString(); // OTP 6 chiffres cryptographiquement sûr
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // Expiration 15 min

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: normalizedEmail, mode: "insensitive" } },
          ...(normalizedPhone ? [{ phoneNumber: normalizedPhone }] : []),
        ],
      },
    });

    if (existingUser) {
      if (existingUser.isVerified) {
        throw new Error("EMAIL_ALREADY_EXISTS");
      }

      // Compte existant non encore vérifié : on met à jour les informations et on renvoie un nouveau code OTP
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          fullName: fullName.trim(),
          passwordHash,
          otpCode: hashToken(otpCode),
          otpExpiresAt,
        },
      });

      if (!isTestMode) {
        const mail = await Emails.otp(existingUser.email, otpCode, fullName.trim());
        void MailService.sendNow(mail);
      }

      return {
        email: existingUser.email,
        message: "Un nouveau code de vérification a été envoyé à votre adresse email.",
        ...(isTestMode ? { testOtpCode: otpCode, otpCode } : {}),
      };
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const roleUser = await prisma.role.findUnique({ where: { name: "USER" } });

    await prisma.user.create({
      data: {
        email: normalizedEmail,
        phoneNumber: normalizedPhone,
        fullName: fullName.trim(),
        passwordHash,
        isVerified: false,
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

    if (!isTestMode) {
      const mail = await Emails.otp(normalizedEmail, otpCode, fullName.trim());
      void MailService.sendNow(mail);
    }

    return {
      email: normalizedEmail,
      message: "Un code de vérification a été envoyé à votre adresse email.",
      ...(isTestMode ? { testOtpCode: otpCode, otpCode } : {}),
    };
  }

  /** Demande de réinitialisation par code OTP à 6 chiffres : réponse identique que le compte existe ou non (anti-énumération). */
  static async forgotPassword(email: string) {
    const genericMessage = "Si un compte correspond à cette adresse, un code de réinitialisation vient d'être envoyé.";
    const isTestMode = isOtpTestMode();
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" } },
    });

    if (!user || user.isSuspended) {
      return { email: normalizedEmail, message: genericMessage };
    }

    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: hashToken(otpCode),
        passwordResetExpiresAt: otpExpiresAt,
      },
    });

    if (!isTestMode) {
      void MailService.sendNow(await Emails.resetPassword(user.email, otpCode, user.fullName));
    }

    return {
      email: user.email,
      message: "Un code de réinitialisation a été envoyé par email.",
      ...(isTestMode ? { testOtpCode: otpCode, otpCode } : {}),
    };
  }

  static async verifyResetOtp(email: string, otpCode: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const code = String(otpCode || "").trim();

    if (!/^\d{6}$/.test(code)) {
      throw new Error("RESET_CODE_INVALID");
    }

    const user = await prisma.user.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: "insensitive" },
        passwordResetToken: hashToken(code),
        passwordResetExpiresAt: { gt: new Date() },
      },
    });

    if (!user) {
      throw new Error("RESET_CODE_INVALID");
    }

    return {
      valid: true,
      email: user.email,
      message: "Code de réinitialisation valide.",
    };
  }

  static async resetPassword(params: {
    token?: string;
    email?: string;
    otpCode?: string;
    password: string;
  } | string, legacyPassword?: string) {
    // Rétrocompatibilité signature (token: string, newPassword: string)
    const normalizedParams = typeof params === "string"
      ? { token: params, password: legacyPassword ?? "" }
      : params;

    let user;
    if (normalizedParams.email && normalizedParams.otpCode) {
      const code = String(normalizedParams.otpCode).trim();
      const normalizedEmail = normalizedParams.email.trim().toLowerCase();
      user = await prisma.user.findFirst({
        where: {
          email: { equals: normalizedEmail, mode: "insensitive" },
          passwordResetToken: hashToken(code),
          passwordResetExpiresAt: { gt: new Date() },
        },
      });
    } else if (normalizedParams.token) {
      user = await prisma.user.findFirst({
        where: {
          passwordResetToken: hashToken(normalizedParams.token),
          passwordResetExpiresAt: { gt: new Date() },
        },
      });
    }

    if (!user) throw new Error("RESET_TOKEN_INVALID");

    const passwordHash = await bcrypt.hash(normalizedParams.password, BCRYPT_ROUNDS);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordResetToken: null,
          passwordResetExpiresAt: null,
          isVerified: true,
        },
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

  static async resendOtp(email: string) {
    const genericMessage = "Si ce compte est en attente de validation, un nouveau code a été envoyé.";
    const isTestMode = isOtpTestMode();
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" } },
    });

    if (!user || user.isVerified || user.isSuspended) {
      // Anti-énumération
      return { email: normalizedEmail, message: genericMessage };
    }

    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode: hashToken(otpCode),
        otpExpiresAt,
      },
    });

    if (!isTestMode) {
      const mail = await Emails.otp(user.email, otpCode, user.fullName);
      void MailService.sendNow(mail);
    }

    return {
      email: user.email,
      message: "Un nouveau code de vérification a été généré.",
      ...(isTestMode ? { testOtpCode: otpCode, otpCode } : {}),
    };
  }

  static async verifyOtp(params: {
    email: string;
    otpCode: string;
    deviceType?: string;
    deviceName?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const user = await prisma.user.findFirst({
      where: { email: { equals: params.email.trim(), mode: "insensitive" } },
      include: {
        userRoles: {
          include: { role: true },
        },
        recommendationProfile: true,
        languagePreferences: { select: { languageCode: true } },
        topicPreferences: { select: { topicId: true } },
      },
    });

    if (!user) {
      throw new Error("INVALID_CREDENTIALS");
    }

    if (user.isSuspended) {
      throw new AccountSuspendedError(user.suspendedReason, user.suspendedAt);
    }

    const inputCode = String(params.otpCode || "").trim();
    if (!/^\d{6}$/.test(inputCode)) {
      throw new Error("INVALID_CREDENTIALS");
    }

    const hashedInput = hashToken(inputCode);
    if (!user.otpCode || user.otpCode !== hashedInput) {
      throw new Error("INVALID_CREDENTIALS");
    }

    if (user.otpExpiresAt && user.otpExpiresAt < new Date()) {
      throw new Error("RESET_TOKEN_EXPIRED");
    }

    // Valider le compte et consommer l'OTP
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        otpCode: null,
        otpExpiresAt: null,
      },
    });

    // Déclencher le mail de bienvenue transactionnel de manière strictement idempotente
    void MailService.enqueueWelcomeEmail({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
    });

    const roles = user.userRoles.map((ur) => ur.role.name);

    const lifetime = resolveTokenLifetime(params.deviceType);

    // Générer Access Token
    const accessToken = jwt.sign(
      { id: user.id, email: user.email, roles },
      JWT_SECRET,
      { expiresIn: lifetime.accessExpiresIn }
    );

    // Générer Refresh Token
    const rawRefreshToken = crypto.randomBytes(40).toString("hex");
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + lifetime.refreshExpiresInDays * 24 * 60 * 60 * 1000);

    let device = null;
    if (params.deviceType) {
      device = await prisma.device.create({
        data: {
          userId: user.id,
          deviceType: params.deviceType || "MOBILE",
          deviceName: params.deviceName || "Appareil Mobile",
        },
      });
    }

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

    const onboardingCompleted = Boolean(user.recommendationProfile?.onboardingCompleted);
    const onboardingState = user.recommendationProfile?.onboardingState ?? (onboardingCompleted ? "COMPLETED" : "NOT_PROMPTED");
    const hasPreferences = (user.languagePreferences?.length || 0) > 0 && (user.topicPreferences?.length || 0) > 0;

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatar: user.avatar,
        roles,
        isVerified: true,
        isSuspended: user.isSuspended,
        suspendedReason: user.suspendedReason,
        onboardingCompleted,
        onboardingState,
        hasPreferences,
        isNewUser: true,
      },
      accessToken,
      refreshToken: rawRefreshToken,
      message: "Compte vérifié avec succès",
    };
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
        recommendationProfile: true,
        languagePreferences: { select: { languageCode: true } },
        topicPreferences: { select: { topicId: true } },
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
      throw new AccountSuspendedError(user.suspendedReason, user.suspendedAt);
    }

    // Le compte doit avoir été vérifié par OTP avant de pouvoir se connecter
    // (uniquement si la fonctionnalité est activée — cf. FeatureFlags.requireVerifiedLogin).
    if (FeatureFlags.requireVerifiedLogin && !user.isVerified) {
      throw new Error("ACCOUNT_NOT_VERIFIED");
    }

    const roles = user.userRoles.map((ur) => ur.role.name);

    const lifetime = resolveTokenLifetime(params.deviceType);

    // Générer Access Token
    const accessToken = jwt.sign(
      { id: user.id, email: user.email, roles },
      JWT_SECRET,
      { expiresIn: lifetime.accessExpiresIn }
    );

    // Générer Refresh Token
    const rawRefreshToken = crypto.randomBytes(40).toString("hex");
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + lifetime.refreshExpiresInDays * 24 * 60 * 60 * 1000);

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

    const onboardingCompleted = Boolean(user.recommendationProfile?.onboardingCompleted);
    const onboardingState = user.recommendationProfile?.onboardingState ?? (onboardingCompleted ? "COMPLETED" : "NOT_PROMPTED");
    const hasPreferences = (user.languagePreferences?.length || 0) > 0 && (user.topicPreferences?.length || 0) > 0;

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatar: user.avatar,
        roles,
        isVerified: user.isVerified,
        isSuspended: user.isSuspended,
        suspendedReason: user.suspendedReason,
        onboardingCompleted,
        onboardingState,
        hasPreferences,
        isNewUser: false,
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
        device: true,
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

    if (storedToken.expiresAt < new Date()) {
      throw new Error("INVALID_REFRESH_TOKEN");
    }

    if (storedToken.user.isSuspended) {
      throw new AccountSuspendedError(storedToken.user.suspendedReason, storedToken.user.suspendedAt);
    }

    // Révocation de l'ancien token (Rotation)
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true },
    });

    const lifetime = resolveTokenLifetime(storedToken.device?.deviceType);

    // Génération du nouveau duo de tokens
    const roles = storedToken.user.userRoles.map((ur) => ur.role.name);
    const newAccessToken = jwt.sign(
      { id: storedToken.user.id, email: storedToken.user.email, roles },
      JWT_SECRET,
      { expiresIn: lifetime.accessExpiresIn }
    );

    const newRawRefreshToken = crypto.randomBytes(40).toString("hex");
    const newHash = hashToken(newRawRefreshToken);
    const newExpiresAt = new Date(Date.now() + lifetime.refreshExpiresInDays * 24 * 60 * 60 * 1000);

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

  static async loginWithGoogle(params: {
    idToken: string;
    deviceType?: string;
    deviceName?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const { OAuth2Client } = await import("google-auth-library");
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const client = new OAuth2Client(clientId);

    const ticket = await client.verifyIdToken({
      idToken: params.idToken,
      audience: clientId,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      throw new Error("GOOGLE_AUTH_FAILED: Impossible de valider le compte Google");
    }

    const email = payload.email.trim().toLowerCase();
    const fullName = payload.name || payload.email.split("@")[0];
    const avatar = payload.picture || null;

    let isNewUser = false;
    let shouldSendWelcome = false;

    let user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      include: {
        userRoles: {
          include: { role: true },
        },
        recommendationProfile: true,
        languagePreferences: { select: { languageCode: true } },
        topicPreferences: { select: { topicId: true } },
      },
    });

    if (user && user.isSuspended) {
      throw new AccountSuspendedError(user.suspendedReason, user.suspendedAt);
    }

    if (!user) {
      isNewUser = true;
      shouldSendWelcome = true;
      // Création automatique de l'utilisateur vérifié
      const roleUser = await prisma.role.findUnique({ where: { name: "USER" } });
      user = await prisma.user.create({
        data: {
          email,
          fullName,
          avatar,
          isVerified: true, // Google vérifie déjà l'adresse email
          recommendationProfile: {
            create: {
              onboardingCompleted: false,
              onboardingState: "NOT_PROMPTED",
            },
          },
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
        include: {
          userRoles: {
            include: { role: true },
          },
          recommendationProfile: true,
          languagePreferences: { select: { languageCode: true } },
          topicPreferences: { select: { topicId: true } },
        },
      });
    } else if (!user.isVerified) {
      // Si l'utilisateur existait mais n'était pas encore vérifié, Google certifie son email
      shouldSendWelcome = user.welcomeEmailSentAt === null;
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          isVerified: true,
          avatar: user.avatar || avatar,
        },
        include: {
          userRoles: {
            include: { role: true },
          },
          recommendationProfile: true,
          languagePreferences: { select: { languageCode: true } },
          topicPreferences: { select: { topicId: true } },
        },
      });
    }

    if (shouldSendWelcome) {
      void MailService.enqueueWelcomeEmail({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      });
    }

    const roles = user.userRoles.map((ur) => ur.role.name);

    const lifetime = resolveTokenLifetime(params.deviceType);

    // Access Token
    const accessToken = jwt.sign(
      { id: user.id, email: user.email, roles },
      JWT_SECRET,
      { expiresIn: lifetime.accessExpiresIn }
    );

    // Refresh Token
    const rawRefreshToken = crypto.randomBytes(40).toString("hex");
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + lifetime.refreshExpiresInDays * 24 * 60 * 60 * 1000);

    let device = null;
    if (params.deviceType) {
      device = await prisma.device.create({
        data: {
          userId: user.id,
          deviceType: params.deviceType || "WEB",
          deviceName: params.deviceName || "Navigateur Web",
        },
      });
    }

    await Promise.all([
      prisma.session.create({
        data: {
          userId: user.id,
          deviceId: device?.id,
          tokenHash,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          expiresAt,
        },
      }),
      prisma.refreshToken.create({
        data: {
          userId: user.id,
          deviceId: device?.id,
          tokenHash,
          expiresAt,
        },
      }),
    ]);

    const onboardingCompleted = Boolean(user.recommendationProfile?.onboardingCompleted);
    const onboardingState = user.recommendationProfile?.onboardingState ?? (onboardingCompleted ? "COMPLETED" : "NOT_PROMPTED");
    const hasPreferences = (user.languagePreferences?.length || 0) > 0 && (user.topicPreferences?.length || 0) > 0;

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatar: user.avatar,
        roles,
        isVerified: user.isVerified,
        isSuspended: user.isSuspended,
        suspendedReason: user.suspendedReason,
        onboardingCompleted,
        onboardingState,
        hasPreferences,
        isNewUser,
      },
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  /**
   * Connexion instantanée sans mot de passe : Envoi d'un code OTP à usage unique
   */
  static async requestOtpLogin(identifier: string) {
    const input = identifier.trim().toLowerCase();
    const phoneVariants = [input];
    if (!input.startsWith("+")) {
      phoneVariants.push(`+223${input}`);
    } else if (input.startsWith("+223")) {
      phoneVariants.push(input.replace("+223", ""));
    }

    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: input, mode: "insensitive" } },
          { username: { equals: input, mode: "insensitive" } },
          { phoneNumber: { in: phoneVariants } },
        ],
      },
    });

    const isTestMode = isOtpTestMode();
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    if (!user) {
      if (!input.includes("@")) {
        throw new Error("USER_NOT_FOUND");
      }
      const roleUser = await prisma.role.findUnique({ where: { name: "USER" } });
      user = await prisma.user.create({
        data: {
          email: input,
          fullName: input.split("@")[0],
          isVerified: false,
          otpCode: hashToken(otpCode),
          otpExpiresAt,
          ...(roleUser ? { userRoles: { create: { roleId: roleUser.id } } } : {}),
        },
      });
    } else {
      if (user.isSuspended) {
        throw new AccountSuspendedError(user.suspendedReason, user.suspendedAt);
      }
      await prisma.user.update({
        where: { id: user.id },
        data: {
          otpCode: hashToken(otpCode),
          otpExpiresAt,
        },
      });
    }

    if (!isTestMode) {
      const mail = await Emails.loginOtp(user.email, otpCode, user.fullName);
      void MailService.sendNow(mail);
    }

    return {
      email: user.email,
      message: "Un code de connexion vous a été envoyé par e-mail.",
      ...(isTestMode ? { testOtpCode: otpCode, otpCode } : {}),
    };
  }

  /**
   * Validation de l'OTP de connexion instantanée
   */
  static async verifyOtpLogin(params: {
    identifier: string;
    otpCode: string;
    deviceType?: string;
    deviceName?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const input = params.identifier.trim().toLowerCase();
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
        recommendationProfile: true,
        languagePreferences: { select: { languageCode: true } },
        topicPreferences: { select: { topicId: true } },
      },
    });

    if (!user) {
      throw new Error("INVALID_CREDENTIALS");
    }

    if (user.isSuspended) {
      throw new AccountSuspendedError(user.suspendedReason, user.suspendedAt);
    }

    const code = String(params.otpCode || "").trim();
    if (!/^\d{6}$/.test(code)) {
      throw new Error("INVALID_CREDENTIALS");
    }

    const hashedInput = hashToken(code);
    if (!user.otpCode || user.otpCode !== hashedInput) {
      throw new Error("INVALID_CREDENTIALS");
    }

    if (user.otpExpiresAt && user.otpExpiresAt < new Date()) {
      throw new Error("RESET_TOKEN_EXPIRED");
    }

    // Valider le compte et consommer l'OTP
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        otpCode: null,
        otpExpiresAt: null,
      },
    });

    const roles = user.userRoles.map((ur) => ur.role.name);
    const lifetime = resolveTokenLifetime(params.deviceType);

    const accessToken = jwt.sign(
      { id: user.id, email: user.email, roles },
      JWT_SECRET,
      { expiresIn: lifetime.accessExpiresIn }
    );

    const rawRefreshToken = crypto.randomBytes(40).toString("hex");
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + lifetime.refreshExpiresInDays * 24 * 60 * 60 * 1000);

    let device = null;
    if (params.deviceType || params.deviceName) {
      device = await prisma.device.create({
        data: {
          userId: user.id,
          deviceType: params.deviceType || "WEB",
          deviceName: params.deviceName || "Navigateur Web",
        },
      });
    }

    await Promise.all([
      prisma.session.create({
        data: {
          userId: user.id,
          deviceId: device?.id,
          tokenHash,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          expiresAt,
        },
      }),
      prisma.refreshToken.create({
        data: {
          userId: user.id,
          deviceId: device?.id,
          tokenHash,
          expiresAt,
        },
      }),
    ]);

    const onboardingCompleted = Boolean(user.recommendationProfile?.onboardingCompleted);
    const onboardingState = user.recommendationProfile?.onboardingState ?? (onboardingCompleted ? "COMPLETED" : "NOT_PROMPTED");
    const hasPreferences = (user.languagePreferences?.length || 0) > 0 && (user.topicPreferences?.length || 0) > 0;

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatar: user.avatar,
        roles,
        isVerified: true,
        isSuspended: user.isSuspended,
        suspendedReason: user.suspendedReason,
        onboardingCompleted,
        onboardingState,
        hasPreferences,
        isNewUser: false,
      },
      accessToken,
      refreshToken: rawRefreshToken,
      message: "Connexion réussie",
    };
  }
}
