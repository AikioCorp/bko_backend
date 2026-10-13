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
   */
  static async unregisterToken(token: string): Promise<void> {
    try {
      await prisma.pushToken.updateMany({
        where: { token },
        data: { isActive: false },
      });
    } catch (e: any) {
      console.error("[PushService] Erreur unregisterToken :", e.message);
    }
  }

  /**
   * Envoie une notification push à un ou plusieurs utilisateurs.
   */
  static async sendToUsers(userIds: string[], payload: PushNotificationPayload): Promise<void> {
    const messaging = getMessagingClient();
    if (!messaging) {
      // En dev ou si Firebase n'est pas encore renseigné, on log sans faire planter
      return;
    }

    try {
      // Récupérer les tokens actifs des utilisateurs cibles
      const tokensRecords = await prisma.pushToken.findMany({
        where: {
          isActive: true,
          device: {
            userId: { in: userIds },
          },
        },
        select: {
          token: true,
        },
      });

      const tokens = tokensRecords.map((t) => t.token).filter(Boolean);
      if (tokens.length === 0) return;

      const message: MulticastMessage = {
        tokens,
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: {
          click_action: "FLUTTER_NOTIFICATION_CLICK",
          route: payload.route || "/",
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
      console.log(`[PushService] Envoyé avec succès : ${response.successCount}/${tokens.length}`);

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
              failedTokens.push(tokens[idx]);
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
    } catch (e: any) {
      console.error("[PushService] Erreur lors de l'envoi push :", e.message);
    }
  }
}
