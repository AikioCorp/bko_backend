import { prisma } from "../../config/prisma.js";

export class AdService {
  /**
   * Récupère les campagnes actives et valides pour un emplacement donné.
   * Règle de rotation explicite : tri par priorité décroissante, puis répartition équitable.
   */
  static async getActiveAds(placement?: string) {
    const now = new Date();

    const where: any = {
      status: "ACTIVE",
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    };

    if (placement && placement !== "ALL") {
      where.OR = [
        { placement },
        { placement: "ALL" },
        { placement: "EXPLORE_CATALOG" },
      ];
    }

    const campaigns = await prisma.adCampaign.findMany({
      where,
      orderBy: [
        { priority: "desc" },
        { impressionsCount: "asc" }, // Rotation équitable : privilégie les campagnes ayant moins d'impressions
        { updatedAt: "desc" },
      ],
      take: 10,
    });

    return campaigns;
  }

  /**
   * Enregistre une impression lorsque la bannière devient réellement visible (IntersectionObserver).
   * Incrémentation atomique sans surcomptage.
   */
  static async recordImpression(id: string) {
    const campaign = await prisma.adCampaign.findUnique({ where: { id } });
    if (!campaign) return null;

    return prisma.adCampaign.update({
      where: { id },
      data: {
        impressionsCount: { increment: 1 },
      },
      select: { id: true, impressionsCount: true },
    });
  }

  /**
   * Enregistre un clic sur une bannière.
   */
  static async recordClick(id: string) {
    const campaign = await prisma.adCampaign.findUnique({ where: { id } });
    if (!campaign) return null;

    return prisma.adCampaign.update({
      where: { id },
      data: {
        clicksCount: { increment: 1 },
      },
      select: { id: true, clicksCount: true, targetUrl: true },
    });
  }

  /**
   * Enregistre une demande de contact d'un annonceur.
   */
  static async createInquiry(data: {
    company: string;
    contactName: string;
    email: string;
    phone?: string;
    targetPeriod?: string;
    budget?: string;
    message: string;
  }) {
    return prisma.advertiserInquiry.create({
      data: {
        company: data.company.trim(),
        contactName: data.contactName.trim(),
        email: data.email.trim().toLowerCase(),
        phone: data.phone?.trim() || null,
        targetPeriod: data.targetPeriod?.trim() || null,
        budget: data.budget?.trim() || null,
        message: data.message.trim(),
        status: "PENDING",
      },
    });
  }

  // ================= ADMIN METHODS =================

  static async listAllCampaigns() {
    return prisma.adCampaign.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  static async createCampaign(data: {
    advertiserName: string;
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    title: string;
    description?: string;
    ctaLabel?: string;
    targetUrl: string;
    imageUrlDesktop: string;
    imageUrlMobile?: string;
    altText?: string;
    placement?: string;
    isSponsored?: boolean;
    status?: string;
    priority?: number;
    startsAt?: string | null;
    endsAt?: string | null;
  }) {
    return prisma.adCampaign.create({
      data: {
        advertiserName: data.advertiserName,
        contactName: data.contactName || null,
        contactEmail: data.contactEmail || null,
        contactPhone: data.contactPhone || null,
        title: data.title,
        description: data.description || null,
        ctaLabel: data.ctaLabel || "En savoir plus",
        targetUrl: data.targetUrl,
        imageUrlDesktop: data.imageUrlDesktop,
        imageUrlMobile: data.imageUrlMobile || null,
        altText: data.altText || null,
        placement: data.placement || "EXPLORE_CATALOG",
        isSponsored: data.isSponsored !== undefined ? data.isSponsored : true,
        status: data.status || "ACTIVE",
        priority: data.priority !== undefined ? data.priority : 0,
        startsAt: data.startsAt ? new Date(data.startsAt) : null,
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
      },
    });
  }

  static async updateCampaign(
    id: string,
    data: Partial<{
      advertiserName: string;
      contactName: string | null;
      contactEmail: string | null;
      contactPhone: string | null;
      title: string;
      description: string | null;
      ctaLabel: string | null;
      targetUrl: string;
      imageUrlDesktop: string;
      imageUrlMobile: string | null;
      altText: string | null;
      placement: string;
      isSponsored: boolean;
      status: string;
      priority: number;
      startsAt: string | null;
      endsAt: string | null;
    }>
  ) {
    const updateData: any = { ...data };
    if (data.startsAt !== undefined) {
      updateData.startsAt = data.startsAt ? new Date(data.startsAt) : null;
    }
    if (data.endsAt !== undefined) {
      updateData.endsAt = data.endsAt ? new Date(data.endsAt) : null;
    }

    return prisma.adCampaign.update({
      where: { id },
      data: updateData,
    });
  }

  static async deleteCampaign(id: string) {
    return prisma.adCampaign.delete({ where: { id } });
  }

  static async listAllInquiries() {
    return prisma.advertiserInquiry.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  static async updateInquiryStatus(id: string, status: string, notes?: string) {
    return prisma.advertiserInquiry.update({
      where: { id },
      data: {
        status,
        ...(notes !== undefined ? { notes } : {}),
      },
    });
  }
}
