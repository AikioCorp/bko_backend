import { prisma } from "../config/prisma.js";

type Capability = "podcastCreationEnabled" | "publishingEnabled" | "uploadEnabled" | "rssImportEnabled" | "monetizationEnabled";
type CreatorCapability = "canCreatePodcast" | "canPublish" | "canUpload" | "canImportRss" | "canMonetize";

const CAPABILITY_MAP: Record<Capability, CreatorCapability> = {
  podcastCreationEnabled: "canCreatePodcast",
  publishingEnabled: "canPublish",
  uploadEnabled: "canUpload",
  rssImportEnabled: "canImportRss",
  monetizationEnabled: "canMonetize",
};

export class MarketAccessService {
  private static async check(
    countryCode: string,
    marketCapability: Capability,
    creatorProfileId?: string
  ): Promise<boolean> {
    const market = await prisma.market.findUnique({
      where: { countryId: countryCode },
    });

    if (!market || market.status === "DISABLED" || market.status === "SUSPENDED") {
      return false;
    }

    // 1. Si le marché est ACTIVE et la capacité globale est activée
    if (market.status === "ACTIVE" && market[marketCapability] === true) {
      return true;
    }

    // 2. Si le créateur possède une autorisation individuelle approuvée (CreatorMarketAccess)
    if (creatorProfileId) {
      const creatorCapability = CAPABILITY_MAP[marketCapability];
      const access = await prisma.creatorMarketAccess.findUnique({
        where: {
          creatorProfileId_marketId: {
            creatorProfileId,
            marketId: market.id,
          },
        },
      });

      if (access && access.status === "APPROVED" && access[creatorCapability] === true) {
        return true;
      }
    }

    // Fallback : Vérifier la capacité globale si non nulle
    return market[marketCapability] === true;
  }

  static async canCreatePodcast(countryCode: string, creatorProfileId?: string): Promise<boolean> {
    return this.check(countryCode, "podcastCreationEnabled", creatorProfileId);
  }

  static async canPublish(countryCode: string, creatorProfileId?: string): Promise<boolean> {
    return this.check(countryCode, "publishingEnabled", creatorProfileId);
  }

  static async canUpload(countryCode: string, creatorProfileId?: string): Promise<boolean> {
    return this.check(countryCode, "uploadEnabled", creatorProfileId);
  }

  static async canImportRss(countryCode: string, creatorProfileId?: string): Promise<boolean> {
    return this.check(countryCode, "rssImportEnabled", creatorProfileId);
  }

  static async canMonetize(countryCode: string, creatorProfileId?: string): Promise<boolean> {
    return this.check(countryCode, "monetizationEnabled", creatorProfileId);
  }
}
