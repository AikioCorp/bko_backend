import { prisma } from "../../config/prisma.js";
import { SubscriptionStatus, SubscriptionScope } from "@prisma/client";
import { AuditService } from "../../services/audit.service.js";

export class SubscriptionService {
  /**
   * Lister toutes les formules d'abonnements actives proposées sur la plateforme.
   */
  static async listPlans() {
    let plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { price: "asc" },
      include: {
        _count: { select: { subscriptions: true } },
      },
    });

    // Auto-seeding des formules par défaut si la base est vide
    if (plans.length === 0) {
      await prisma.subscriptionPlan.createMany({
        data: [
          {
            name: "Pass Bamako Podcast Illimité",
            slug: "pass-illimite-mensuel",
            price: 2000,
            currency: "XOF",
            interval: "MONTHLY",
            description: "Accès illimité à 100% des épisodes exclusifs, écoute sans coupure publicitaire et son haute définition.",
            features: [
              "Écoute sans coupures publicitaires",
              "Accès à 100% des épisodes payants",
              "Téléchargement hors-ligne illimité",
              "Badge Auditeur VIP dans la communauté",
              "Qualité audio studio HD 320 kbps",
            ],
            isActive: true,
            scope: SubscriptionScope.PLATFORM,
          },
          {
            name: "Pass Annuel Privilège",
            slug: "pass-annuel-privilege",
            price: 20000,
            currency: "XOF",
            interval: "YEARLY",
            description: "12 mois d'accès illimité avec 2 mois offerts + invitations aux enregistrements live en studio à Bamako.",
            features: [
              "2 mois offerts chaque année (économie de 4 000 FCFA)",
              "Accès prioritaire aux avant-premières",
              "Invitations aux sessions d'enregistrement en direct à Bamako",
              "Support VIP direct via WhatsApp",
              "Tous les avantages du Pass Mensuel inclus",
            ],
            isActive: true,
            scope: SubscriptionScope.PLATFORM,
          },
          {
            name: "Soutien Créateur Mensuel",
            slug: "soutien-createur-mensuel",
            price: 1000,
            currency: "XOF",
            interval: "MONTHLY",
            description: "Abonnement direct pour soutenir les créateurs indépendants du Mali et accéder à leurs bonus exclusifs.",
            features: [
              "Épisodes bonus et coulisses réservés",
              "Salon de discussion privé avec les créateurs",
              "Accès anticipé 48h avant tout le monde",
            ],
            isActive: true,
            scope: SubscriptionScope.PLATFORM,
          },
        ],
      });

      plans = await prisma.subscriptionPlan.findMany({
        where: { isActive: true },
        orderBy: { price: "asc" },
        include: {
          _count: { select: { subscriptions: true } },
        },
      });
    }

    return plans;
  }

  /**
   * Consulter l'abonnement actif et l'historique complet d'un utilisateur.
   */
  static async getUserSubscription(userId: string) {
    const now = new Date();

    const [user, subscriptions, transactions, purchasedEpisodes] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, fullName: true },
      }),
      prisma.userSubscription.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { plan: true },
      }),
      prisma.paymentTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: {
          subscription: { include: { plan: true } },
          episode: { select: { id: true, title: true, slug: true, cover: true } },
        },
      }),
      prisma.paymentTransaction.findMany({
        where: { userId, episodeId: { not: null }, status: "SUCCESS" },
        select: { episodeId: true },
      }),
    ]);

    if (!user) throw new Error("USER_NOT_FOUND");

    const activeSubscription = subscriptions.find(
      (s) => s.status === SubscriptionStatus.ACTIVE && new Date(s.currentPeriodEnd) > now
    );

    const totalSpent = transactions
      .filter((t) => t.status === "SUCCESS")
      .reduce((acc, t) => acc + t.amount, 0);

    return {
      hasActiveSubscription: !!activeSubscription,
      activeSubscription: activeSubscription || null,
      subscriptions,
      transactions,
      purchasedEpisodeIds: purchasedEpisodes.map((p) => p.episodeId as string),
      totalSpent,
      currency: "XOF",
    };
  }

  /**
   * Souscrire à un abonnement via Mobile Money (Orange Money, Wave, Moov Money) ou Carte Bancaire.
   */
  static async checkout(
    userId: string,
    data: {
      planId: string;
      paymentMethod: string;
      phoneNumber?: string;
      autoRenew?: boolean;
    },
    ip?: string
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("USER_NOT_FOUND");

    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: data.planId } });
    if (!plan || !plan.isActive) throw new Error("PLAN_NOT_FOUND");

    // Calculer la durée selon la formule
    const days = plan.interval === "YEARLY" ? 365 : 30;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);

    // Générer une référence de transaction unique réaliste (ex: BKO-OM-782912)
    const prefix = data.paymentMethod === "ORANGE_MONEY" ? "OM" : data.paymentMethod === "WAVE" ? "WAVE" : data.paymentMethod === "MOOV_MONEY" ? "MOOV" : "CB";
    const transactionRef = `BKO-${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Désactiver les anciens abonnements actifs s'il y en avait
      await tx.userSubscription.updateMany({
        where: { userId, status: SubscriptionStatus.ACTIVE },
        data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
      });

      // 2. Créer le nouvel abonnement
      const sub = await tx.userSubscription.create({
        data: {
          userId,
          planId: plan.id,
          status: SubscriptionStatus.ACTIVE,
          paymentMethod: data.paymentMethod,
          currentPeriodStart: startDate,
          currentPeriodEnd: endDate,
          cancelAtPeriodEnd: !(data.autoRenew ?? true),
        },
        include: { plan: true },
      });

      // 3. Enregistrer la transaction de paiement validée
      const payment = await tx.paymentTransaction.create({
        data: {
          userId,
          subscriptionId: sub.id,
          amount: plan.price,
          currency: plan.currency,
          status: "SUCCESS",
          paymentMethod: data.paymentMethod,
          transactionRef,
          note: `Abonnement ${plan.name} (${data.phoneNumber ? `Numéro : ${data.phoneNumber}` : "Paiement validé"})`,
        },
      });

      // 4. Envoyer une notification in-app immédiate
      await tx.notification.create({
        data: {
          userId,
          title: "🎉 Bienvenue dans Bamako Podcast Premium !",
          body: `Votre formule « ${plan.name} » est désormais active jusqu'au ${endDate.toLocaleDateString("fr-FR")}. Vous bénéficiez de l'écoute illimitée sans coupure publicitaire et de tout le catalogue exclusif.`,
          link: "/premium",
          type: "SUBSCRIPTION_ACTIVATED",
        },
      });

      return { subscription: sub, transaction: payment };
    });

    await AuditService.logAction({
      actorId: userId,
      action: "SUBSCRIPTION_CHECKOUT",
      entityType: "USER_SUBSCRIPTION",
      entityId: result.subscription.id,
      ipAddress: ip,
      newState: {
        planId: plan.id,
        planName: plan.name,
        price: plan.price,
        paymentMethod: data.paymentMethod,
        ref: transactionRef,
      },
    });

    return {
      success: true,
      message: "Votre abonnement a été activé avec succès !",
      subscription: result.subscription,
      transaction: result.transaction,
    };
  }

  /**
   * Acheter un épisode payant à l'unité (Pay-per-episode).
   */
  static async buyEpisode(
    userId: string,
    data: {
      episodeId: string;
      paymentMethod: string;
      phoneNumber?: string;
    },
    ip?: string
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("USER_NOT_FOUND");

    const episode = await prisma.episode.findUnique({
      where: { id: data.episodeId },
      include: { podcast: { select: { name: true } } },
    });
    if (!episode) throw new Error("EPISODE_NOT_FOUND");

    // Vérifier si l'utilisateur l'a déjà acheté
    const alreadyBought = await prisma.paymentTransaction.findFirst({
      where: { userId, episodeId: data.episodeId, status: "SUCCESS" },
    });
    if (alreadyBought) {
      return { success: true, message: "Vous possédez déjà cet épisode !", transaction: alreadyBought };
    }

    const price = episode.premiumPrice || 500;
    const prefix = data.paymentMethod === "ORANGE_MONEY" ? "OM" : data.paymentMethod === "WAVE" ? "WAVE" : "CB";
    const transactionRef = `BKO-EP-${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;

    const transaction = await prisma.paymentTransaction.create({
      data: {
        userId,
        episodeId: episode.id,
        amount: price,
        currency: "XOF",
        status: "SUCCESS",
        paymentMethod: data.paymentMethod,
        transactionRef,
        note: `Achat unitaire de l'épisode « ${episode.title} »`,
      },
      include: {
        episode: { select: { id: true, title: true, slug: true, cover: true } },
      },
    });

    await prisma.notification.create({
      data: {
        userId,
        title: "Épisode débloqué !",
        body: `Votre achat de l'épisode « ${episode.title} » (${episode.podcast.name}) est confirmé. Vous pouvez l'écouter sans limite.`,
        link: `/podcasts/${episode.podcastId}`,
        type: "EPISODE_PURCHASED",
      },
    });

    await AuditService.logAction({
      actorId: userId,
      action: "BUY_EPISODE",
      entityType: "EPISODE",
      entityId: episode.id,
      ipAddress: ip,
      newState: { price, paymentMethod: data.paymentMethod, ref: transactionRef },
    });

    return {
      success: true,
      message: "Épisode débloqué avec succès !",
      transaction,
    };
  }

  /**
   * Résilier son abonnement actif.
   */
  static async cancelSubscription(userId: string, subscriptionId: string, ip?: string) {
    const sub = await prisma.userSubscription.findFirst({
      where: { id: subscriptionId, userId },
      include: { plan: true },
    });
    if (!sub) throw new Error("SUBSCRIPTION_NOT_FOUND");

    const updated = await prisma.userSubscription.update({
      where: { id: subscriptionId },
      data: {
        cancelAtPeriodEnd: true,
      },
      include: { plan: true },
    });

    await AuditService.logAction({
      actorId: userId,
      action: "USER_CANCEL_SUBSCRIPTION",
      entityType: "USER_SUBSCRIPTION",
      entityId: subscriptionId,
      ipAddress: ip,
      newState: { planName: sub.plan.name, currentPeriodEnd: sub.currentPeriodEnd },
    });

    return {
      success: true,
      message: `Votre abonnement ne sera pas renouvelé après le ${new Date(sub.currentPeriodEnd).toLocaleDateString("fr-FR")}. Vos accès restent valables jusqu'à cette date.`,
      subscription: updated,
    };
  }

  /**
   * Vérifier les droits d'accès à un épisode.
   */
  static async checkEpisodeAccess(userId: string | undefined, episodeId: string) {
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: {
        id: true,
        title: true,
        slug: true,
        isPremium: true,
        premiumPrice: true,
        podcastId: true,
        podcast: {
          select: {
            id: true,
            name: true,
            slug: true,
            isPremium: true,
            members: { select: { userId: true, role: true } },
          },
        },
      },
    });

    if (!episode) throw new Error("EPISODE_NOT_FOUND");

    // Si le contenu est gratuit, accès immédiat pour tous
    if (!episode.isPremium && !episode.podcast.isPremium) {
      return {
        hasAccess: true,
        reason: "FREE",
        episode: { isPremium: false, premiumPrice: null },
      };
    }

    // Si non connecté et contenu payant
    if (!userId) {
      return {
        hasAccess: false,
        reason: "PREMIUM_REQUIRED",
        episode: { isPremium: true, premiumPrice: episode.premiumPrice || 500 },
      };
    }

    // 1. Vérifier si l'utilisateur est admin ou propriétaire de l'émission
    const [userRoles, membership] = await Promise.all([
      prisma.userRole.findMany({
        where: { userId },
        include: { role: true },
      }),
      prisma.podcastMember.findFirst({
        where: { userId, podcastId: episode.podcastId },
      }),
    ]);

    const isAdmin = userRoles.some((ur) => ["SUPER_ADMIN", "ADMIN"].includes(ur.role.name));
    if (isAdmin || membership) {
      return {
        hasAccess: true,
        reason: isAdmin ? "ADMIN_BYPASS" : "CREATOR_OWNER",
        episode: { isPremium: true, premiumPrice: episode.premiumPrice },
      };
    }

    // 2. Vérifier si l'utilisateur a un abonnement actif
    const now = new Date();
    const activeSub = await prisma.userSubscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: { gt: now },
      },
      include: { plan: true },
    });

    if (activeSub) {
      return {
        hasAccess: true,
        reason: "ACTIVE_SUBSCRIPTION",
        subscriptionPlan: activeSub.plan.name,
        episode: { isPremium: true, premiumPrice: episode.premiumPrice },
      };
    }

    // 3. Vérifier si l'utilisateur a acheté cet épisode individuellement
    const singlePurchase = await prisma.paymentTransaction.findFirst({
      where: {
        userId,
        episodeId,
        status: "SUCCESS",
      },
    });

    if (singlePurchase) {
      return {
        hasAccess: true,
        reason: "EPISODE_PURCHASED",
        episode: { isPremium: true, premiumPrice: episode.premiumPrice },
      };
    }

    // Pas d'accès : paywall
    return {
      hasAccess: false,
      reason: "PREMIUM_REQUIRED",
      episode: {
        isPremium: true,
        premiumPrice: episode.premiumPrice || 500,
      },
    };
  }
}
