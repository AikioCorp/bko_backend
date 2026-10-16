import fs from "fs";
import path from "path";
import { cert, initializeApp, getApps, App } from "firebase-admin/app";
import { getMessaging, MulticastMessage } from "firebase-admin/messaging";
import { prisma } from "../config/prisma.js";

let firebaseApp: App | null = null;

function getMessagingClient() {
  if (firebaseApp) return getMessaging(firebaseApp);
  if (getApps().length > 0) {
    firebaseApp = getApps()[0];
    return getMessaging(firebaseApp);
  }

  // Initialisation via JSON string dans la variable FIREBASE_SERVICE_ACCOUNT_KEY
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  if (serviceAccountKey) {
    try {
      const credentials = JSON.parse(serviceAccountKey);
      firebaseApp = initializeApp({
        credential: cert(credentials),
      });
      console.log("[PushService] Firebase Admin initialisé avec succès.");
      return getMessaging(firebaseApp);
    } catch (e: any) {
      console.error("[PushService] Échec du parse des credentials Firebase :", e.message);
    }
  }

  // Fallback si fichier json pointé par variable d'environnement standard
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      firebaseApp = initializeApp();
      console.log("[PushService] Firebase Admin initialisé via applicationDefault.");
      return getMessaging(firebaseApp);
    } catch (e: any) {
      console.error("[PushService] Échec de l'initialisation standard :", e.message);
    }
  }

  // Fallback local file: firebase-service-account.json à la racine du backend
  try {
    const localKeyPath = path.resolve(process.cwd(), "firebase-service-account.json");
    if (fs.existsSync(localKeyPath)) {
      const fileContent = fs.readFileSync(localKeyPath, "utf-8");
      const credentials = JSON.parse(fileContent);
      firebaseApp = initializeApp({
        credential: cert(credentials),
      });
      console.log("[PushService] Firebase Admin initialisé via firebase-service-account.json local.");
      return getMessaging(firebaseApp);
    }
  } catch (_) {}

  return null;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  route?: string; // ex: /podcasts/bamako-tech/episodes/12
  imageUrl?: string;
  data?: Record<string, string>;
}

export class PushNotificationService {
  /**
   * Enregistre ou met à jour le token de push pour un appareil.
   */
  static async registerToken(params: {
    userId: string;
    token: string;
    deviceType?: string;
    deviceName?: string;
  }): Promise<boolean> {
    try {
      const { userId, token, deviceType = "ANDROID", deviceName } = params;

      // 1. Trouver ou créer le device de l'utilisateur
      let device = await prisma.device.findFirst({
        where: {
          userId,
          deviceType: deviceType.toUpperCase(),
        },
      });

      if (!device) {
        device = await prisma.device.create({
          data: {
            userId,
            deviceType: deviceType.toUpperCase(),
            deviceName: deviceName || (deviceType.toUpperCase() === "IOS" ? "iPhone" : "Appareil Android"),
          },
        });
      }

      // 2. Associer ou mettre à jour le PushToken
      await prisma.pushToken.upsert({
        where: { token },
        create: {
          deviceId: device.id,
          token,
          provider: "FCM",
          isActive: true,
        },
        update: {
          deviceId: device.id,
          isActive: true,
          updatedAt: new Date(),
        },
      });

      return true;
    } catch (e: any) {
      console.error("[PushService] Erreur lors de l'enregistrement du push token :", e.message);
      return false;
    }
  }

  /**
   * Désactive un token de push (par exemple au logout).
   * Si userId est fourni, vérifie que le token appartient bien à cet utilisateur.
   */
  static async unregisterToken(token: string, userId?: string): Promise<void> {
    try {
      await prisma.pushToken.updateMany({
        where: {
          token,
          ...(userId ? { device: { userId } } : {}),
        },
        data: { isActive: false },
      });
    } catch (e: any) {
      console.error("[PushService] Erreur unregisterToken :", e.message);
    }
  }

  /**
   * Envoie une notification push à un ou plusieurs utilisateurs.
   * Gère les lots par paquets de 500 tokens (limite imposée par Firebase Multicast)
   * et exclut les utilisateurs suspendus.
   */
  static async sendToUsers(userIds: string[], payload: PushNotificationPayload): Promise<void> {
    const messaging = getMessagingClient();
    if (!messaging) {
      // En dev ou si Firebase n'est pas encore renseigné, on log sans faire planter
      return;
    }

    try {
      // Récupérer les tokens actifs des utilisateurs cibles non suspendus
      const tokensRecords = await prisma.pushToken.findMany({
        where: {
          isActive: true,
          device: {
            userId: { in: userIds },
            user: { isSuspended: false },
          },
        },
        select: {
          token: true,
        },
      });

      const tokens = [...new Set(tokensRecords.map((t) => t.token).filter(Boolean))];
      if (tokens.length === 0) return;

      // Découpage en lots de 500 tokens max (contrainte stricte de l'API Firebase Admin)
      const BATCH_SIZE = 500;
      let totalSuccess = 0;

      for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        const batchTokens = tokens.slice(i, i + BATCH_SIZE);

        const message: MulticastMessage = {
          tokens: batchTokens,
          notification: {
            title: payload.title,
            body: payload.body,
            imageUrl: payload.imageUrl,
          },
          data: {
            click_action: "FLUTTER_NOTIFICATION_CLICK",
            route: payload.route || "/",
            link: payload.route || "/",
            ...(payload.data || {}),
          },
          android: {
            priority: "high",
            notification: {
              sound: "default",
              channelId: "bamako_podcast_channel",
              clickAction: "FLUTTER_NOTIFICATION_CLICK",
            },
          },
          apns: {
            payload: {
              aps: {
                sound: "default",
                badge: 1,
              },
            },
          },
        };

        const response = await messaging.sendEachForMulticast(message);
        totalSuccess += response.successCount;

        // Nettoyer les tokens expirés ou invalidés par Google/Apple
        if (response.failureCount > 0) {
          const failedTokens: string[] = [];
          response.responses.forEach((resp: any, idx: number) => {
            if (!resp.success) {
              const errCode = resp.error?.code;
              if (
                errCode === "messaging/invalid-registration-token" ||
                errCode === "messaging/registration-token-not-registered"
              ) {
                failedTokens.push(batchTokens[idx]);
              }
            }
          });

          if (failedTokens.length > 0) {
            await prisma.pushToken.updateMany({
              where: { token: { in: failedTokens } },
              data: { isActive: false },
            });
            console.log(`[PushService] ${failedTokens.length} token(s) invalide(s) désactivé(s).`);
          }
        }
      }

      console.log(`[PushService] Envoyé avec succès : ${totalSuccess}/${tokens.length}`);
    } catch (e: any) {
      console.error("[PushService] Erreur lors de l'envoi push :", e.message);
    }
  }

  /**
   * Diagnostic d'infrastructure push : vérifie la présence des identifiants Firebase,
   * le nombre de tokens actifs par plateforme et l'état de la file outbox.
   */
  static async getDiagnostics() {
    const messaging = getMessagingClient();
    const isFirebaseConfigured = messaging !== null;
    const totalDevices = await prisma.device.count();
    const activeTokens = await prisma.pushToken.count({ where: { isActive: true } });
    const tokensByDevice = await prisma.device.groupBy({
      by: ["deviceType"],
      _count: { id: true },
    });
    const recentFailedTokens = await prisma.pushToken.count({ where: { isActive: false } });
    const pendingPushJobs = await prisma.jobQueueItem.count({
      where: { queueName: "push_notifications", status: "PENDING" },
    });
    const failedPushJobs = await prisma.jobQueueItem.count({
      where: { queueName: "push_notifications", status: "FAILED" },
    });

    return {
      provider: "FIREBASE_FCM",
      isConfigured: isFirebaseConfigured,
      configurationStatus: isFirebaseConfigured
        ? "CONFIGURED_AND_READY"
        : "MISSING_CREDENTIALS (FIREBASE_SERVICE_ACCOUNT_KEY / GOOGLE_APPLICATION_CREDENTIALS / firebase-service-account.json)",
      metrics: {
        totalDevices,
        activeTokens,
        recentFailedTokens,
        pendingPushJobs,
        failedPushJobs,
        devicesByType: tokensByDevice.map((t) => ({ type: t.deviceType, count: t._count.id })),
      },
    };
  }
}
