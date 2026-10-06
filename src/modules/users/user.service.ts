import { prisma } from "../../config/prisma.js";

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

    const { userRoles, ...cleanUser } = user;

    return {
      ...cleanUser,
      roles,
      permissions,
    };
  }

  static async updateMe(userId: string, data: { fullName?: string; avatar?: string }) {
    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        fullName: true,
        avatar: true,
      },
    });
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
}
