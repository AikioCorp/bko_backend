import { prisma } from "../../config/prisma.js";

export class DownloadService {
  /**
   * Enregistre ou met à jour la présence d'un appareil mobile actif pour l'utilisateur.
   */
  static async syncDevice(
    userId: string,
    data: {
      deviceType?: string;
      deviceName?: string;
      osVersion?: string;
      appVersion?: string;
      deviceFingerprint?: string;
    }
  ) {
    const deviceType = (data.deviceType || "MOBILE").toUpperCase();
    const now = new Date();

    let device = null;
    if (data.deviceFingerprint) {
      device = await prisma.device.findFirst({
        where: { userId, deviceFingerprint: data.deviceFingerprint },
      });
    }

    if (!device) {
      // Rechercher un appareil récent de même type
      device = await prisma.device.findFirst({
        where: { userId, deviceType },
        orderBy: { lastActiveAt: "desc" },
      });
    }

    if (device) {
      return prisma.device.update({
        where: { id: device.id },
        data: {
          lastActiveAt: now,
          deviceName: data.deviceName || device.deviceName,
          osVersion: data.osVersion || device.osVersion,
          appVersion: data.appVersion || device.appVersion,
        },
      });
    }

    return prisma.device.create({
      data: {
        userId,
        deviceType,
        deviceName: data.deviceName || (deviceType === "MOBILE" ? "Téléphone mobile" : "Navigateur Web"),
        osVersion: data.osVersion,
        appVersion: data.appVersion,
        deviceFingerprint: data.deviceFingerprint,
        lastActiveAt: now,
      },
    });
  }

  /**
   * Vérifie si l'utilisateur possède au moins un appareil mobile actif (dans les 30 derniers jours).
   */
  static async getMobileDeviceStatus(userId: string) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const mobileDevice = await prisma.device.findFirst({
      where: {
        userId,
        deviceType: "MOBILE",
        lastActiveAt: { gte: thirtyDaysAgo },
      },
      orderBy: { lastActiveAt: "desc" },
    });

    if (!mobileDevice) {
      return {
        hasActiveMobile: false,
        device: null,
      };
    }

    return {
      hasActiveMobile: true,
      device: {
        id: mobileDevice.id,
        deviceName: mobileDevice.deviceName,
        osVersion: mobileDevice.osVersion,
        appVersion: mobileDevice.appVersion,
        lastActiveAt: mobileDevice.lastActiveAt,
      },
    };
  }

  /**
   * Met en file d'attente un ordre de téléchargement distant émis depuis le web vers le mobile.
   */
  static async queueRemoteDownload(userId: string, episodeId: string, clientSource = "WEB") {
    // 1. Vérifier si un mobile actif existe
    const mobileStatus = await this.getMobileDeviceStatus(userId);
    if (!mobileStatus.hasActiveMobile) {
      return {
        queued: false,
        hasActiveMobile: false,
        device: null,
        message:
          "Aucun appareil mobile actif associé à ce compte. Veuillez vous connecter sur l'application mobile Bamako Podcast pour que vos téléchargements s'y lancent automatiquement.",
      };
    }

    // 2. Vérifier que l'épisode existe
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      include: {
        podcast: { select: { id: true, name: true, slug: true, cover: true } },
        mediaSources: true,
      },
    });

    if (!episode) {
      throw new Error("Épisode introuvable");
    }

    // 3. Vérifier si un ordre similaire est déjà en attente
    const pendingJobs = await prisma.jobQueueItem.findMany({
      where: {
        queueName: "REMOTE_DOWNLOAD",
        status: "PENDING",
      },
      take: 50,
      orderBy: { createdAt: "desc" },
    });

    const alreadyQueued = pendingJobs.find((j) => {
      const p = j.payload as any;
      return p && p.userId === userId && p.episodeId === episodeId;
    });

    if (alreadyQueued) {
      return {
        queued: true,
        alreadyQueued: true,
        hasActiveMobile: true,
        device: mobileStatus.device,
        message: `Ce téléchargement est déjà en attente sur votre appareil (${mobileStatus.device?.deviceName || "Mobile"}). Il se lancera à l'ouverture de l'application.`,
      };
    }

    // 4. Créer la tâche dans JobQueueItem
    await prisma.jobQueueItem.create({
      data: {
        queueName: "REMOTE_DOWNLOAD",
        jobType: "EPISODE_OFFLINE_SYNC",
        payload: {
          userId,
          episodeId,
          requestedFrom: clientSource,
          targetDeviceId: mobileStatus.device?.id,
          targetDeviceName: mobileStatus.device?.deviceName,
          requestedAt: new Date().toISOString(),
        },
        status: "PENDING",
      },
    });

    return {
      queued: true,
      alreadyQueued: false,
      hasActiveMobile: true,
      device: mobileStatus.device,
      message: `Téléchargement programmé ! Il démarrera automatiquement sur votre téléphone (${mobileStatus.device?.deviceName || "Mobile"}).`,
    };
  }

  /**
   * Récupère les ordres de téléchargement en attente pour un utilisateur (appelé par le mobile).
   */
  static async getPendingRemoteDownloads(userId: string) {
    const pendingJobs = await prisma.jobQueueItem.findMany({
      where: {
        queueName: "REMOTE_DOWNLOAD",
        status: "PENDING",
      },
      orderBy: { createdAt: "asc" },
      take: 20,
    });

    const userJobs = pendingJobs.filter((j) => {
      const p = j.payload as any;
      return p && p.userId === userId && p.episodeId;
    });

    if (userJobs.length === 0) {
      return [];
    }

    const episodeIds = userJobs.map((j) => (j.payload as any).episodeId);
    const episodes = await prisma.episode.findMany({
      where: { id: { in: episodeIds } },
      include: {
        podcast: {
          select: {
            id: true,
            slug: true,
            name: true,
            cover: true,
          },
        },
        mediaSources: true,
      },
    });

    const episodeMap = new Map(episodes.map((e) => [e.id, e]));

    return userJobs
      .map((job) => {
        const payload = job.payload as any;
        const ep = episodeMap.get(payload.episodeId);
        if (!ep) return null;
        return {
          queueId: job.id,
          episodeId: ep.id,
          episode: ep,
          queuedAt: job.createdAt,
        };
      })
      .filter(Boolean);
  }

  /**
   * Valide la réception ou la complétion d'un téléchargement distant (appelé par le mobile).
   */
  static async ackRemoteDownload(
    userId: string,
    queueId: string,
    status: "COMPLETED" | "FAILED" = "COMPLETED"
  ) {
    const job = await prisma.jobQueueItem.findUnique({
      where: { id: queueId },
    });

    if (!job) {
      return { success: true };
    }

    const payload = job.payload as any;
    if (payload?.userId !== userId) {
      throw new Error("FORBIDDEN");
    }

    await prisma.jobQueueItem.update({
      where: { id: queueId },
      data: {
        status: status === "COMPLETED" ? "COMPLETED" : "FAILED",
        updatedAt: new Date(),
      },
    });

    return { success: true };
  }
}
