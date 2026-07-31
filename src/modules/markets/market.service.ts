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

  static async updateCreatorAccess(
    accessId: string,
    input: {
      status?: CreatorMarketAccessStatus;
      canCreatePodcast?: boolean;
      canPublish?: boolean;
      canUpload?: boolean;
      canImportRss?: boolean;
      canMonetize?: boolean;
    },
    grantedById?: string
  ) {
    const previous = await prisma.creatorMarketAccess.findUnique({ where: { id: accessId } });
    if (!previous) {
      throw new Error("CREATOR_ACCESS_NOT_FOUND");
    }

    const CAPABILITIES = ["canCreatePodcast", "canPublish", "canUpload", "canImportRss", "canMonetize"] as const;

    // Construction du patch à partir des seuls champs réellement fournis.
    const data: Record<string, unknown> = {};
    if (input.status !== undefined) {
      data.status = input.status;
      data.grantedById = grantedById;
      data.grantedAt = input.status === "APPROVED" ? new Date() : undefined;
    }
    for (const cap of CAPABILITIES) {
      if (input[cap] !== undefined) data[cap] = input[cap];
    }

    const updated = await prisma.creatorMarketAccess.update({
      where: { id: accessId },
      data,
    });

    // Journalisation d'audit PAR capacité modifiée (spécification 5.5.1) :
    // admin, creator, market, capability, ancienne valeur, nouvelle valeur.
    for (const cap of CAPABILITIES) {
      if (input[cap] !== undefined && previous[cap] !== input[cap]) {
        await AuditService.logAction({
          actorId: grantedById,
          action: input[cap] ? "CREATOR_MARKET_CAPABILITY_GRANTED" : "CREATOR_MARKET_CAPABILITY_REVOKED",
          entityType: "CreatorMarketAccess",
          entityId: accessId,
          previousState: {
            creatorProfileId: previous.creatorProfileId,
            marketId: previous.marketId,
            capability: cap,
            value: previous[cap],
          },
          newState: { capability: cap, value: input[cap] },
        });
      }
    }

    // Journalisation du changement de statut d'accès (APPROVED / REJECTED / ...).
    if (input.status !== undefined && previous.status !== input.status) {
      await AuditService.logAction({
        actorId: grantedById,
        action: "CREATOR_MARKET_ACCESS_STATUS_CHANGED",
        entityType: "CreatorMarketAccess",
        entityId: accessId,
        previousState: { status: previous.status },
        newState: { status: input.status },
      });
    }

    return updated;
  }
}
