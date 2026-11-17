import { prisma } from "../../config/prisma.js";
import { MailService } from "../../services/mail/mail.service.js";
import { SubscriptionStatus } from "@prisma/client";

function randomCode(prefix: string, len = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${out.slice(0, 4)}-${out.slice(4)}`;
}

export class MonetizationService {
  // --- 1. POURBOIRES / DONS DIRECTS AUX CRÉATEURS ---
  static async createTip(
    podcastId: string,
    input: {
      episodeId?: string;
      supporterName: string;
      supporterEmail?: string;
      message?: string;
      amount: number;
      paymentMethod: string;
      phoneNumber?: string;
    },
    userId?: string
  ) {
    const podcast = await prisma.podcast.findUnique({
      where: { id: podcastId },
      select: {
        id: true,
        name: true,
        members: { select: { userId: true } },
      },
    });
    if (!podcast) {
      throw new Error("Émission introuvable");
    }

    const transactionRef = `BKO-TIP-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .substring(2, 6)
      .toUpperCase()}`;

    const tip = await prisma.creatorTip.create({
      data: {
        podcastId,
        episodeId: input.episodeId || null,
        userId: userId || null,
        supporterName: input.supporterName.trim(),
        supporterEmail: input.supporterEmail?.trim().toLowerCase() || null,
        message: input.message?.trim() || null,
        amount: input.amount,
        currency: "XOF",
        paymentMethod: input.paymentMethod,
        phoneNumber: input.phoneNumber?.trim() || null,
        transactionRef,
        status: "COMPLETED",
      },
    });

    // Notifier les membres créateurs de l'émission
    for (const m of podcast.members) {
      try {
        await prisma.notification.create({
          data: {
            userId: m.userId,
            title: "💛 Nouveau soutien reçu !",
            body: `${tip.supporterName} a envoyé ${tip.amount.toLocaleString("fr-FR")} FCFA à « ${podcast.name} »${tip.message ? ` : "${tip.message}"` : ""}.`,
            link: "/studio",
            type: "CREATOR_TIP_RECEIVED",
          },
        });
      } catch (_) {}
    }

    return {
      id: tip.id,
      transactionRef: tip.transactionRef,
      amount: tip.amount,
      currency: tip.currency,
      paymentMethod: tip.paymentMethod,
      supporterName: tip.supporterName,
      message: tip.message,
      createdAt: tip.createdAt,
    };
  }

  static async getPodcastTips(podcastId: string) {
    const [tips, agg] = await Promise.all([
      prisma.creatorTip.findMany({
        where: { podcastId, status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          supporterName: true,
          message: true,
          amount: true,
          currency: true,
          paymentMethod: true,
          createdAt: true,
        },
      }),
      prisma.creatorTip.aggregate({
        where: { podcastId, status: "COMPLETED" },
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);

    return {
      totalAmount: agg._sum.amount || 0,
      supportersCount: agg._count.id || 0,
      recentTips: tips,
    };
  }

  // --- 2. CODES PROMO ---
  static async validatePromoCode(rawCode: string) {
    const code = rawCode.trim().toUpperCase();
    if (!code) throw new Error("Code promo requis");

    const promo = await prisma.promoCode.findUnique({ where: { code } });
    if (!promo || !promo.isActive) {
      throw new Error("Code promo invalide ou inactif");
    }
    if (promo.expiresAt && promo.expiresAt < new Date()) {
      throw new Error("Ce code promo a expiré");
    }
    if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
      throw new Error("Ce code promo a atteint sa limite d'utilisations");
    }

    return {
      id: promo.id,
      code: promo.code,
      description: promo.description,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
    };
  }

  static async listPromoCodes() {
    return prisma.promoCode.findMany({ orderBy: { createdAt: "desc" } });
  }

  static async createPromoCode(input: {
    code: string;
    description?: string;
    discountType: "PERCENT" | "FIXED";
    discountValue: number;
    maxUses?: number | null;
    expiresAt?: string | null;
  }) {
    const cleanCode = input.code.trim().toUpperCase();
    const existing = await prisma.promoCode.findUnique({ where: { code: cleanCode } });
    if (existing) throw new Error("Ce code promo existe déjà");

    return prisma.promoCode.create({
      data: {
        code: cleanCode,
        description: input.description?.trim() || null,
        discountType: input.discountType,
        discountValue: input.discountValue,
        maxUses: input.maxUses ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        isActive: true,
      },
    });
  }

  // --- 3. PASS CADEAUX ---
  static async purchaseGiftPass(
    input: {
      planId: string;
      recipientName?: string;
      recipientEmail?: string;
      message?: string;
      paymentMethod: string;
    },
    buyerUserId?: string
  ) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: input.planId } });
    if (!plan || !plan.isActive) {
      throw new Error("Formule d'abonnement introuvable");
    }

    let code = randomCode("BKO-GIFT", 8);
    while (await prisma.giftPass.findUnique({ where: { code } })) {
      code = randomCode("BKO-GIFT", 8);
    }

    const gift = await prisma.giftPass.create({
      data: {
        code,
        planId: plan.id,
        buyerUserId: buyerUserId || null,
        recipientName: input.recipientName?.trim() || null,
        recipientEmail: input.recipientEmail?.trim().toLowerCase() || null,
        message: input.message?.trim() || null,
        amount: plan.price,
        paymentMethod: input.paymentMethod,
        status: "AVAILABLE",
      },
      include: { plan: true },
    });

    if (gift.recipientEmail) {
      try {
        await MailService.enqueue({
          to: gift.recipientEmail,
          subject: `🎁 Vous avez reçu un Pass Cadeau Bamako Podcast (${plan.name}) !`,
          text: `Bonjour${gift.recipientName ? ` ${gift.recipientName}` : ""},\n\nOn vous a offert un Pass Cadeau Bamako Podcast (${plan.name}) !\nVotre code cadeau : ${gift.code}\n${gift.message ? `Message : "${gift.message}"\n` : ""}\nActivez-le dès maintenant sur https://bamakopodcast.studio/premium`,
          html: `<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;background:#111;color:#fff;border-radius:12px;">
            <h2 style="color:#FFBF00;">🎁 Pass Cadeau Bamako Podcast</h2>
            <p>Bonjour${gift.recipientName ? ` <strong>${gift.recipientName}</strong>` : ""},</p>
            <p>Vous avez reçu un abonnement <strong>${plan.name}</strong>.</p>
            ${gift.message ? `<blockquote style="border-left:3px solid #FFBF00;padding-left:12px;color:#ddd;">${gift.message}</blockquote>` : ""}
            <p style="font-size:18px;font-weight:bold;color:#FFBF00;letter-spacing:1px;">Code : ${gift.code}</p>
            <p><a href="https://bamakopodcast.studio/premium" style="color:#FFBF00;">Activer mon Pass Cadeau</a></p>
          </div>`,
        });
      } catch (_) {}
    }

    return gift;
  }

  static async redeemGiftPass(rawCode: string, userId: string) {
    const code = rawCode.trim().toUpperCase();
    const gift = await prisma.giftPass.findUnique({
      where: { code },
      include: { plan: true },
    });
    if (!gift) throw new Error("Code Pass Cadeau introuvable");
    if (gift.status !== "AVAILABLE") throw new Error("Ce Pass Cadeau a déjà été utilisé ou annulé");

    const now = new Date();
    const periodEnd = new Date(now);
    if (gift.plan.interval === "YEARLY") {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else if (gift.plan.interval === "LIFETIME") {
      periodEnd.setFullYear(periodEnd.getFullYear() + 50);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedGift = await tx.giftPass.update({
        where: { id: gift.id },
        data: {
          status: "REDEEMED",
          redeemedByUserId: userId,
          redeemedAt: now,
        },
        include: { plan: true },
      });

      const subscription = await tx.userSubscription.create({
        data: {
          userId,
          planId: gift.planId,
          status: SubscriptionStatus.ACTIVE,
          paymentMethod: "GIFT_PASS",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
        include: { plan: true },
      });

      return { gift: updatedGift, subscription };
    });

    return result;
  }

  static async getMyGiftPasses(userId: string) {
    return prisma.giftPass.findMany({
      where: {
        OR: [{ buyerUserId: userId }, { redeemedByUserId: userId }],
      },
      include: { plan: { select: { name: true, interval: true, price: true } } },
      orderBy: { createdAt: "desc" },
    });
  }
}
