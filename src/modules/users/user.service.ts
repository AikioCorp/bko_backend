import bcrypt from "bcrypt";
import { prisma } from "../../config/prisma.js";
import { StorageFactory } from "../../services/storage/storage.factory.js";
import { LocalMockStorageProvider } from "../../services/storage/local-mock-storage.provider.js";
import { CreatorProfileService } from "../creator/creator-profile.service.js";
import { invalidateAccountStatusCache } from "../../middlewares/auth.middleware.js";

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
        follows: { select: { podcastId: true } },
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

    const { userRoles, passwordHash, follows, ...cleanUser } = user;
    const followedPodcastIds = (follows || []).map((pf) => pf.podcastId);
    const hasPreferences = (user.languagePreferences?.length || 0) > 0 && (user.topicPreferences?.length || 0) > 0;
    const onboardingCompleted = Boolean(user.recommendationProfile?.onboardingCompleted);
    const onboardingState = user.recommendationProfile?.onboardingState ?? (onboardingCompleted ? "COMPLETED" : "NOT_PROMPTED");

    const [studioAccess, activitySummary] = await Promise.all([
      CreatorProfileService.getStudioAccess(userId),
      UserService.getUserActivitySummary(userId),
    ]);

    return {
      ...cleanUser,
      hasPassword: Boolean(passwordHash),
      roles,
      permissions,
      hasPreferences,
      followedPodcastIds,
      onboardingCompleted,
      onboardingState,
      hasStudioAccess: studioAccess.canAccess,
      isCollaborator: studioAccess.isCollaborator,
      canCreatePodcast: studioAccess.canCreatePodcast,
      totalPlatformSeconds: activitySummary.totalPlatformSeconds,
      totalListenSeconds: activitySummary.totalListenSeconds,
      lastLoginAt: activitySummary.lastLoginAt,
      lastActiveAt: activitySummary.lastActiveAt,
      isOnline: activitySummary.isOnline,
    };
  }

  static async updateMe(userId: string, data: { fullName?: string; avatar?: string; phoneNumber?: string | null; bio?: string }) {
    const userData: { fullName?: string; avatar?: string | null; phoneNumber?: string | null } = {};
    if (typeof data.fullName === "string" && data.fullName.trim()) {
      userData.fullName = data.fullName.trim();
    }
    if (data.avatar === null || (typeof data.avatar === "string" && data.avatar.trim())) {
      userData.avatar = data.avatar ? data.avatar.trim() : null;
    }

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

    if (typeof data.bio === "string") {
      const creator = await prisma.creatorProfile.findUnique({ where: { userId } });
      if (creator) {
        await prisma.creatorProfile.update({
          where: { userId },
          data: { bio: data.bio.trim() },
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
    const device = await prisma.device.findFirst({ where: { id: deviceId, userId } });
    if (!device) {
      throw new Error("Appareil introuvable.");
    }
    await prisma.session.deleteMany({ where: { userId, deviceId } });
    await prisma.refreshToken.updateMany({ where: { userId, deviceId }, data: { isRevoked: true } });
    await prisma.device.deleteMany({ where: { id: deviceId, userId } });
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

    if (user.passwordHash) {
      if (!passwordConfirm) {
        throw new Error("Le mot de passe de confirmation est requis.");
      }
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
    invalidateAccountStatusCache(userId);

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

    const mimeType = (data.mimeType || "image/jpeg").toLowerCase().trim();
    if (!["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"].includes(mimeType)) {
      throw new Error("Format d'image non supporté (JPEG, PNG, WebP ou GIF uniquement).");
    }
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
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      if (!(storage as any).s3Client) {
        throw new Error("Stockage d'images indisponible.");
      }
      await (storage as any).s3Client.send(
        new PutObjectCommand({
          Bucket: (storage as any).bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        })
      );
    }

    const publicUrl = await storage.createPresignedDownloadUrl(key);
    await prisma.user.update({
      where: { id: userId },
      data: { avatar: publicUrl },
    });

    return this.getMe(userId);
  }

  static async recordActivityPing(
    userId: string,
    params: {
      activeSeconds?: number;
      deviceType?: string;
      deviceName?: string;
      ipAddress?: string;
    }
  ) {
    const delta = Math.max(0, Math.min(120, Math.round(Number(params.activeSeconds) || 60)));
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);

    // 1. Mettre à jour l'activité récente sur l'appareil le plus récent
    const latestDevice = await prisma.device.findFirst({
      where: { userId },
      orderBy: { lastActiveAt: "desc" },
      select: { id: true },
    });
    if (latestDevice) {
      await prisma.device.update({
        where: { id: latestDevice.id },
        data: { lastActiveAt: now },
      });
    }

    // 2. Récupérer ou initialiser la métrique de temps cumulé sur la plateforme
    const existingMetric = await prisma.auditLog.findFirst({
      where: {
        actorId: userId,
        action: "USER_PLATFORM_TIME",
        entityType: "USER_METRICS",
        entityId: userId,
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingMetric) {
      const prevState =
        existingMetric.newState && typeof existingMetric.newState === "object"
          ? (existingMetric.newState as Record<string, any>)
          : {};
      const prevSeconds = Number(prevState.totalPlatformSeconds || 0);
      const lastPingAt = prevState.lastPingAt ? new Date(prevState.lastPingAt) : null;

      // Anti-spam : si moins de 20s depuis le dernier ping, ne pas doubler le cumul
      if (lastPingAt && now.getTime() - lastPingAt.getTime() < 20 * 1000) {
        return {
          totalPlatformSeconds: prevSeconds,
          lastActiveAt: now.toISOString(),
          throttled: true,
        };
      }

      const prevDaily =
        prevState.dailySeconds && typeof prevState.dailySeconds === "object"
          ? ({ ...prevState.dailySeconds } as Record<string, number>)
          : {};
      prevDaily[todayIso] = Number(prevDaily[todayIso] || 0) + delta;

      // Conserver uniquement les 30 derniers jours pour garder un JSON compact
      const recentDays = Object.keys(prevDaily).sort().slice(-30);
      const compactedDaily: Record<string, number> = {};
      for (const d of recentDays) {
        compactedDaily[d] = prevDaily[d];
      }

      const nextSeconds = prevSeconds + delta;
      await prisma.auditLog.update({
        where: { id: existingMetric.id },
        data: {
          ipAddress: params.ipAddress || existingMetric.ipAddress,
          newState: {
            totalPlatformSeconds: nextSeconds,
            lastPingAt: now.toISOString(),
            lastDeviceType: params.deviceType || prevState.lastDeviceType || "WEB",
            lastDeviceName: params.deviceName || prevState.lastDeviceName || "Navigateur Web",
            dailySeconds: compactedDaily,
          },
        },
      });

      return {
        totalPlatformSeconds: nextSeconds,
        lastActiveAt: now.toISOString(),
        throttled: false,
      };
    }

    const listenAgg = await prisma.playbackHistory.aggregate({
      where: { userId },
      _sum: { positionSeconds: true },
    });
    const initialSeconds = (listenAgg._sum.positionSeconds || 0) + delta;

    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: "USER_PLATFORM_TIME",
        entityType: "USER_METRICS",
        entityId: userId,
        ipAddress: params.ipAddress || null,
        newState: {
          totalPlatformSeconds: initialSeconds,
          lastPingAt: now.toISOString(),
          lastDeviceType: params.deviceType || "WEB",
          lastDeviceName: params.deviceName || "Navigateur Web",
          dailySeconds: { [todayIso]: delta },
        },
      },
    });

    return {
      totalPlatformSeconds: initialSeconds,
      lastActiveAt: now.toISOString(),
      throttled: false,
    };
  }

  static async getUserActivitySummary(userId: string) {
    const [platformMetric, playbackAgg, loginLogs, devices, activeSessions] = await Promise.all([
      prisma.auditLog.findFirst({
        where: {
          actorId: userId,
          action: "USER_PLATFORM_TIME",
          entityType: "USER_METRICS",
          entityId: userId,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.playbackHistory.aggregate({
        where: { userId },
        _sum: { positionSeconds: true },
        _max: { lastPlayedAt: true },
      }),
      prisma.auditLog.findMany({
        where: {
          entityType: "USER",
          entityId: userId,
          action: "USER_LOGIN",
        },
        orderBy: { createdAt: "desc" },
        take: 25,
      }),
      prisma.device.findMany({
        where: { userId },
        orderBy: { lastActiveAt: "desc" },
        take: 15,
      }),
      prisma.session.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 15,
        include: {
          device: {
            select: {
              deviceType: true,
              deviceName: true,
              lastActiveAt: true,
            },
          },
        },
      }),
    ]);

    const metricState =
      platformMetric?.newState && typeof platformMetric.newState === "object"
        ? (platformMetric.newState as Record<string, any>)
        : {};

    const totalListenSeconds = playbackAgg._sum.positionSeconds || 0;
    const trackedPlatformSeconds = Number(metricState.totalPlatformSeconds || 0);
    const totalPlatformSeconds = Math.max(trackedPlatformSeconds, totalListenSeconds);

    type LoginHistoryEntry = {
      id: string;
      createdAt: string;
      method: string;
      deviceType: string;
      deviceName: string;
      ipAddress: string | null;
      userAgent: string | null;
      isActive: boolean;
    };

    const historyEntries: LoginHistoryEntry[] = [];

    for (const log of loginLogs) {
      const state =
        log.newState && typeof log.newState === "object"
          ? (log.newState as Record<string, any>)
          : {};
      const logTime = log.createdAt.getTime();
      const matchingSession = activeSessions.find(
        (s) => Math.abs(s.createdAt.getTime() - logTime) <= 60 * 1000 && s.expiresAt > new Date()
      );
      historyEntries.push({
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        method: String(state.method || "SESSION"),
        deviceType: String(state.deviceType || matchingSession?.device?.deviceType || "WEB"),
        deviceName: String(state.deviceName || matchingSession?.device?.deviceName || "Navigateur Web"),
        ipAddress: log.ipAddress || matchingSession?.ipAddress || null,
        userAgent: typeof state.userAgent === "string" ? state.userAgent : matchingSession?.userAgent || null,
        isActive: Boolean(matchingSession),
      });
    }

    // Inclure les sessions existantes antérieures au tracking USER_LOGIN (dédupliquées à 60s près)
    for (const session of activeSessions) {
      const sTime = session.createdAt.getTime();
      const alreadyIncluded = historyEntries.some(
        (entry) => Math.abs(new Date(entry.createdAt).getTime() - sTime) <= 60 * 1000
      );
      if (!alreadyIncluded) {
        historyEntries.push({
          id: `session_${session.id}`,
          createdAt: session.createdAt.toISOString(),
          method: "SESSION",
          deviceType: session.device?.deviceType || "WEB",
          deviceName: session.device?.deviceName || "Session active",
          ipAddress: session.ipAddress || null,
          userAgent: session.userAgent || null,
          isActive: session.expiresAt > new Date(),
        });
      }
    }

    historyEntries.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const lastLoginAt = historyEntries[0]?.createdAt || null;

    const activityCandidates: number[] = [];
    if (metricState.lastPingAt) {
      const t = new Date(metricState.lastPingAt).getTime();
      if (!Number.isNaN(t)) activityCandidates.push(t);
    }
    if (devices[0]?.lastActiveAt) activityCandidates.push(devices[0].lastActiveAt.getTime());
    if (activeSessions[0]?.updatedAt) activityCandidates.push(activeSessions[0].updatedAt.getTime());
    if (playbackAgg._max.lastPlayedAt) activityCandidates.push(playbackAgg._max.lastPlayedAt.getTime());
    if (lastLoginAt) activityCandidates.push(new Date(lastLoginAt).getTime());

    const latestMs = activityCandidates.length > 0 ? Math.max(...activityCandidates) : null;
    const lastActiveAt = latestMs ? new Date(latestMs).toISOString() : null;
    const isOnline = latestMs ? Date.now() - latestMs <= 5 * 60 * 1000 : false;

    return {
      totalPlatformSeconds,
      totalPlatformHours: Math.round((totalPlatformSeconds / 3600) * 10) / 10,
      totalListenSeconds,
      totalListenHours: Math.round((totalListenSeconds / 3600) * 10) / 10,
      lastLoginAt,
      lastActiveAt,
      isOnline,
      dailySeconds:
        metricState.dailySeconds && typeof metricState.dailySeconds === "object"
          ? metricState.dailySeconds
          : {},
      loginHistory: historyEntries.slice(0, 25),
    };
  }
}
