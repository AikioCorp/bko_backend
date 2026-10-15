import bcrypt from "bcrypt";
import { prisma } from "../../config/prisma.js";
import { StorageFactory } from "../../services/storage/storage.factory.js";
import { LocalMockStorageProvider } from "../../services/storage/local-mock-storage.provider.js";

export class UserService {
  static async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phoneNumber: true,
        fullName: true,
        avatar: true,
        isVerified: true,
        isSuspended: true,
        suspendedAt: true,
        suspendedReason: true,
        createdAt: true,
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
        creatorProfile: {
          include: {
            person: true,
          },
        },
        languagePreferences: { include: { language: true } },
        topicPreferences: { include: { topic: true } },
        countryPreferences: { include: { country: true } },
        notificationPreference: true,
        recommendationProfile: {
          select: {
            onboardingCompleted: true,
            onboardingState: true,
            onboardingPromptedAt: true,
            onboardingDismissedAt: true,
          },
        },
        passwordHash: true,
      },
    });

    if (!user) throw new Error("USER_NOT_FOUND");

    const roles = user.userRoles?.map((ur) => ur.role?.name).filter(Boolean) || [];
    const permissions = Array.from(
      new Set(
        user.userRoles?.flatMap((ur) =>
          ur.role?.rolePermissions?.map((rp) => rp.permission?.code).filter(Boolean) || []
        ) || []
      )
    );

    const { userRoles, passwordHash, ...cleanUser } = user;
    const hasPreferences = (user.languagePreferences?.length || 0) > 0 && (user.topicPreferences?.length || 0) > 0;
    const onboardingCompleted = Boolean(user.recommendationProfile?.onboardingCompleted);
    const onboardingState = user.recommendationProfile?.onboardingState ?? (onboardingCompleted ? "COMPLETED" : "NOT_PROMPTED");

    return {
      ...cleanUser,
      hasPassword: Boolean(passwordHash),
      roles,
      permissions,
      hasPreferences,
      onboardingCompleted,
      onboardingState,
    };
  }

  static async updateMe(userId: string, data: { fullName?: string; avatar?: string; phoneNumber?: string | null; bio?: string }) {
    const { bio, ...userData } = data as any;

    if ("phoneNumber" in data) {
      const raw = data.phoneNumber;
      if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
        userData.phoneNumber = null;
      } else {
        const trimmed = typeof raw === "string" ? raw.trim() : String(raw).trim();
        const existing = await prisma.user.findFirst({
          where: {
            phoneNumber: trimmed,
            NOT: { id: userId },
          },
        });
        if (existing) {
          throw new Error("Ce numéro de téléphone est déjà associé à un autre compte.");
        }
        userData.phoneNumber = trimmed;
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: userData,
      select: {
        id: true,
        email: true,
        phoneNumber: true,
        fullName: true,
        avatar: true,
      },
    });

    if (typeof bio === "string") {
      const creator = await prisma.creatorProfile.findUnique({ where: { userId } });
      if (creator) {
        await prisma.creatorProfile.update({
          where: { userId },
          data: { bio: bio.trim() },
        });
      }
    }

    return updated;
  }

  static async updatePreferences(
    userId: string,
    data: {
      languageCodes?: string[];
      topicIds?: string[];
      countryIds?: string[];
      notifications?: { emailNewEpisodes?: boolean; pushNewEpisodes?: boolean; editorialHighlights?: boolean };
    }
  ) {
    const { languageCodes, topicIds, countryIds, notifications } = data;

    if (languageCodes) {
      await prisma.userLanguagePreference.deleteMany({ where: { userId } });
      await prisma.userLanguagePreference.createMany({
        data: languageCodes.map((code) => ({ userId, languageCode: code })),
      });
    }

    if (topicIds) {
      await prisma.userTopicPreference.deleteMany({ where: { userId } });
      await prisma.userTopicPreference.createMany({
        data: topicIds.map((topicId) => ({ userId, topicId })),
      });
    }

    if (countryIds) {
      await prisma.userCountryPreference.deleteMany({ where: { userId } });
      await prisma.userCountryPreference.createMany({
        data: countryIds.map((countryId) => ({ userId, countryId })),
      });
    }

    if (notifications) {
      await prisma.notificationPreference.upsert({
        where: { userId },
        update: notifications,
        create: { userId, ...notifications },
      });
    }

    return this.getMe(userId);
  }

  static async getDevices(userId: string) {
    return prisma.device.findMany({
      where: { userId },
      orderBy: { lastActiveAt: "desc" },
    });
  }

  static async revokeDevice(userId: string, deviceId: string) {
    await prisma.session.deleteMany({ where: { userId, deviceId } });
    await prisma.refreshToken.updateMany({ where: { userId, deviceId }, data: { isRevoked: true } });
    await prisma.device.delete({ where: { id: deviceId } });
    return { message: "Appareil révoqué" };
  }

  static async revokeAllOtherDevices(userId: string, currentDeviceId?: string) {
    await prisma.session.deleteMany({
      where: {
        userId,
        ...(currentDeviceId ? { deviceId: { not: currentDeviceId } } : {}),
      },
    });
    await prisma.refreshToken.updateMany({
      where: {
        userId,
        ...(currentDeviceId ? { deviceId: { not: currentDeviceId } } : {}),
      },
      data: { isRevoked: true },
    });
    await prisma.device.deleteMany({
      where: {
        userId,
        ...(currentDeviceId ? { id: { not: currentDeviceId } } : {}),
      },
    });
    return { message: "Toutes les autres sessions ont été déconnectées." };
  }

  static async changePassword(userId: string, data: { currentPassword?: string; newPassword: string }) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, email: true },
    });
    if (!user) throw new Error("USER_NOT_FOUND");

    if (user.passwordHash) {
      if (!data.currentPassword) {
        throw new Error("Le mot de passe actuel est requis.");
      }
      const match = await bcrypt.compare(data.currentPassword, user.passwordHash);
      if (!match) {
        throw new Error("Mot de passe actuel incorrect.");
      }
    }

    if (!data.newPassword || data.newPassword.length < 8 || data.newPassword.length > 72) {
      throw new Error("Le nouveau mot de passe doit contenir entre 8 et 72 caractères.");
    }

    const newHash = await bcrypt.hash(data.newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    return { message: "Mot de passe modifié avec succès." };
  }

  static async exportData(userId: string) {
    const [user, saved, follows, playlists, history] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          fullName: true,
          phoneNumber: true,
          createdAt: true,
          updatedAt: true,
          notificationPreference: true,
        },
      }),
      prisma.savedEpisode.findMany({
        where: { userId },
        include: {
          episode: {
            select: { id: true, title: true, slug: true, durationSeconds: true },
          },
        },
      }),
      prisma.podcastFollow.findMany({
        where: { userId },
        include: {
          podcast: {
            select: { id: true, name: true, slug: true },
          },
        },
      }),
      prisma.playlist.findMany({
        where: { userId },
        include: {
          items: {
            include: {
              episode: {
                select: { id: true, title: true, slug: true },
              },
            },
          },
        },
      }),
      prisma.playbackHistory.findMany({
        where: { userId },
        orderBy: { lastPlayedAt: "desc" },
        take: 100,
        include: {
          episode: {
            select: { id: true, title: true, slug: true },
          },
        },
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      user,
      savedEpisodes: saved,
      followedPodcasts: follows,
      playlists,
      recentHistory: history,
    };
  }

  static async deleteAccount(userId: string, passwordConfirm?: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, email: true },
    });
    if (!user) throw new Error("USER_NOT_FOUND");

    if (user.passwordHash && passwordConfirm) {
      const match = await bcrypt.compare(passwordConfirm, user.passwordHash);
      if (!match) throw new Error("Mot de passe de confirmation incorrect.");
    }

    await prisma.session.deleteMany({ where: { userId } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.device.deleteMany({ where: { userId } });

    const anonymizedEmail = `deleted_${userId}_${Date.now()}@bamakopodcast.deleted`;
    await prisma.user.update({
      where: { id: userId },
      data: {
        email: anonymizedEmail,
        fullName: "Utilisateur supprimé",
        phoneNumber: null,
        avatar: null,
        passwordHash: null,
        isSuspended: true,
        suspendedReason: "Compte supprimé par l'auditeur",
        suspendedAt: new Date(),
      },
    });

    return { message: "Votre compte a été supprimé." };
  }

  static async submitSupportTicket(
    userId: string,
    data: {
      subject: string;
      category?: string;
      description: string;
      appVersion?: string;
      osVersion?: string;
    }
  ) {
    const ticketId = `BKO-${Date.now().toString(36).toUpperCase()}`;

    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: "SUPPORT_REQUEST_SUBMITTED",
        entityType: "SUPPORT_TICKET",
        entityId: ticketId,
        newState: {
          ticketId,
          subject: data.subject,
          category: data.category || "GENERAL",
          description: data.description,
          appVersion: data.appVersion,
          osVersion: data.osVersion,
        },
      },
    });

    return {
      ticketId,
      status: "OPEN",
      receivedAt: new Date().toISOString(),
      message: "Votre demande a été enregistrée. Notre équipe vous répondra par e-mail dans les plus brefs délais.",
    };
  }

  static async uploadAvatar(
    userId: string,
    data: { imageBase64: string; mimeType?: string }
  ) {
    if (!data.imageBase64) throw new Error("Image manquante ou invalide");
    const rawBase64 = data.imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
    const buffer = Buffer.from(rawBase64, "base64");
    if (buffer.length === 0) throw new Error("Fichier image vide");
    if (buffer.length > 10 * 1024 * 1024) throw new Error("L'image dépasse la limite de 10 Mo");

    const mimeType = (data.mimeType || "image/jpeg").toLowerCase();
    const ext = mimeType.includes("png")
      ? "png"
      : mimeType.includes("webp")
      ? "webp"
      : mimeType.includes("gif")
      ? "gif"
      : "jpg";
    const key = `images/avatars/${userId}_${Date.now()}.${ext}`;

    const storage = StorageFactory.getProvider();
    if (storage instanceof LocalMockStorageProvider) {
      const path = storage.filePath(key);
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, buffer);
    } else {
      try {
        const { PutObjectCommand } = await import("@aws-sdk/client-s3");
        if ((storage as any).s3Client) {
          await (storage as any).s3Client.send(
            new PutObjectCommand({
              Bucket: (storage as any).bucket,
              Key: key,
              Body: buffer,
              ContentType: mimeType,
            })
          );
        }
      } catch (err) {
        console.error("[uploadAvatar] R2 upload error:", err);
      }
    }

    const publicUrl = await storage.createPresignedDownloadUrl(key);
    await prisma.user.update({
      where: { id: userId },
      data: { avatar: publicUrl },
    });

    return this.getMe(userId);
  }
}
