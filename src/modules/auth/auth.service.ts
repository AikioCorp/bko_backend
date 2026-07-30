import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/prisma.js";

const JWT_SECRET = process.env.JWT_SECRET || "bamako-podcast-super-secret-jwt-key-2026";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "bamako-podcast-super-secret-refresh-key-2026";

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

    // Vérifier unicité email & téléphone
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, ...(phoneNumber ? [{ phoneNumber }] : [])],
      },
    });

    if (existingUser) {
      throw new Error("EMAIL_ALREADY_EXISTS");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString(); // Code OTP 6 chiffres

    const roleUser = await prisma.role.findUnique({ where: { name: "USER" } });

    const user = await prisma.user.create({
      data: {
        email,
        phoneNumber,
        fullName,
        passwordHash,
        isVerified: false,
        otpCode,
        otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000), // Expiration 15 mins
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

    return {
      userId: user.id,
      email: user.email,
      otpCode, // À envoyer par SMS / Email
    };
  }

  static async verifyOtp(params: { email: string; otpCode: string }) {
    const user = await prisma.user.findUnique({ where: { email: params.email } });

    if (!user || user.otpCode !== params.otpCode) {
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
    identifier: string; // Email ou Téléphone
    password: string;
    deviceType?: string;
    deviceName?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: params.identifier }, { phoneNumber: params.identifier }],
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

    if (!storedToken || storedToken.isRevoked || storedToken.expiresAt < new Date()) {
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
