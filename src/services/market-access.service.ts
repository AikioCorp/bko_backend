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

    // 1. Marché ACTIVE : la capacité globale s'applique à tous les créateurs éligibles.
    if (market.status === "ACTIVE" && market[marketCapability] === true) {
      return true;
    }

    // 2. Sinon (ex. CREATOR_BETA, ou capacité globale désactivée) : SEUL un override
    //    individuel APPROUVÉ accorde la capacité. On ne retombe jamais sur la capacité
    //    globale du marché — sans quoi un marché en bêta accorderait implicitement la
    //    capacité à tout le monde (cf. Verticale 5.5.1).
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

    return false;
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
