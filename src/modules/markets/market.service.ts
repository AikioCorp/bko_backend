import { prisma } from "../../config/prisma.js";
import { MarketStatus, CreatorMarketAccessStatus } from "@prisma/client";
import { AuditService } from "../../services/audit.service.js";

export class MarketService {
  static async getPublicMarkets() {
    return prisma.market.findMany({
      where: {
        status: { in: ["ACTIVE", "CREATOR_BETA", "CATALOG_ONLY"] },
      },
      include: {
        country: true,
      },
      orderBy: { isFeatured: "desc" },
    });
  }

  static async getAdminMarkets() {
    return prisma.market.findMany({
      include: {
        country: true,
        _count: { select: { creatorAccesses: true } },
      },
      orderBy: { countryId: "asc" },
    });
  }

  static async getMarketByCountryCode(countryCode: string) {
    const market = await prisma.market.findUnique({
      where: { countryId: countryCode },
      include: {
        country: true,
        creatorAccesses: {
          include: {
            creatorProfile: true,
          },
        },
      },
    });
    return market;
  }

  static async updateMarket(
    countryCode: string,
    data: {
      status?: MarketStatus;
      discoveryEnabled?: boolean;
      creatorSignupEnabled?: boolean;
      podcastCreationEnabled?: boolean;
      publishingEnabled?: boolean;
      uploadEnabled?: boolean;
      rssImportEnabled?: boolean;
      monetizationEnabled?: boolean;
      isFeatured?: boolean;
      launchDate?: Date | null;
    }
  ) {
    return prisma.market.update({
      where: { countryId: countryCode },
      data,
      include: { country: true },
    });
  }

  static async checkCapability(
    countryCode: string,
    capability: "podcastCreationEnabled" | "publishingEnabled" | "uploadEnabled" | "rssImportEnabled",
    creatorProfileId?: string
  ): Promise<boolean> {
    const market = await prisma.market.findUnique({
      where: { countryId: countryCode },
    });

    if (!market || market.status === "DISABLED" || market.status === "SUSPENDED") {
      return false;
    }

    if (market[capability] === true) {
      return true;
    }

    if (creatorProfileId) {
      const access = await prisma.creatorMarketAccess.findUnique({
        where: {
          creatorProfileId_marketId: {
            creatorProfileId,
            marketId: market.id,
          },
        },
      });
      if (access && access.status === "APPROVED") {
        return true;
      }
    }

    return false;
  }

  static async requestBetaAccess(creatorProfileId: string, countryCode: string) {
    const market = await prisma.market.findUnique({ where: { countryId: countryCode } });
    if (!market) throw new Error("MARKET_NOT_FOUND");

    return prisma.creatorMarketAccess.upsert({
      where: {
        creatorProfileId_marketId: { creatorProfileId, marketId: market.id },
      },
      update: { status: "PENDING" },
      create: {
        creatorProfileId,
        marketId: market.id,
        status: "PENDING",
      },
    });
  }

  static async updateCreatorAccess(accessId: string, status: CreatorMarketAccessStatus, grantedById?: string) {
    const previous = await prisma.creatorMarketAccess.findUnique({ where: { id: accessId } });

    const updated = await prisma.creatorMarketAccess.update({
      where: { id: accessId },
      data: {
        status,
        grantedById,
        grantedAt: status === "APPROVED" ? new Date() : undefined,
      },
    });

    // Journalisation d'audit selon spécification 5.5.1
    const auditAction = status === "APPROVED" ? "CREATOR_MARKET_CAPABILITY_GRANTED" : "CREATOR_MARKET_CAPABILITY_REVOKED";

    await AuditService.logAction({
      actorId: grantedById,
      action: auditAction,
      entityType: "CreatorMarketAccess",
      entityId: accessId,
      previousState: previous,
      newState: updated,
    });

    return updated;
  }
}
