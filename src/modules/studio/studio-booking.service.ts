import { prisma } from "../../config/prisma.js";
import { StudioBookingNeed, StudioBookingStatus } from "@prisma/client";

function generateBookingReference(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `BKO-STU-${dateStr}-${rand}`;
}

export interface CreateBookingInput {
  needType: StudioBookingNeed;
  offerId?: string;
  contactName: string;
  podcastName?: string;
  company?: string;
  email: string;
  phone: string;
  countryCode?: string;
  preferredDate?: string;
  timeSlot?: string;
  durationHours?: number;
  participantsCount?: number;
  studioLocation?: string;
  shootingNeeds?: string;
  mediaFilesUrl?: string;
  targetDeadline?: string;
  expectedResult?: string;
  snippetsCount?: number;
  aspectRatios?: string[];
  subtitlesNeeded?: boolean;
  coachingGoal?: string;
  projectStage?: string;
  notes?: string;
  estimatedPrice?: string;
}

export class StudioBookingService {
  static async createBooking(input: CreateBookingInput, userId?: string) {
    let reference = generateBookingReference();

    // S'assurer de l'unicité de la référence
    let exists = await prisma.studioBooking.findUnique({ where: { reference } });
    while (exists) {
      reference = generateBookingReference();
      exists = await prisma.studioBooking.findUnique({ where: { reference } });
    }

    // Récupérer l'offre si fournie pour vérifier son existence et le tarif
    let resolvedPrice = input.estimatedPrice;
    if (input.offerId) {
      const offer = await prisma.studioOffer.findUnique({ where: { id: input.offerId } });
      if (offer && !resolvedPrice) {
        resolvedPrice = `${offer.price} ${offer.unit || "FCFA"}`;
      }
    }

    const booking = await prisma.studioBooking.create({
      data: {
        reference,
        userId: userId || null,
        needType: input.needType,
        offerId: input.offerId || null,
        contactName: input.contactName.trim(),
        podcastName: input.podcastName?.trim() || null,
        company: input.company?.trim() || null,
        email: input.email.trim().toLowerCase(),
        phone: input.phone.trim(),
        countryCode: input.countryCode?.trim() || "+223",
        preferredDate: input.preferredDate?.trim() || null,
        timeSlot: input.timeSlot?.trim() || null,
        durationHours: input.durationHours || null,
        participantsCount: input.participantsCount || null,
        studioLocation: input.studioLocation?.trim() || null,
        shootingNeeds: input.shootingNeeds?.trim() || null,
        mediaFilesUrl: input.mediaFilesUrl?.trim() || null,
        targetDeadline: input.targetDeadline?.trim() || null,
        expectedResult: input.expectedResult?.trim() || null,
        snippetsCount: input.snippetsCount || null,
        aspectRatios: Array.isArray(input.aspectRatios) ? input.aspectRatios : [],
        subtitlesNeeded: Boolean(input.subtitlesNeeded),
        coachingGoal: input.coachingGoal?.trim() || null,
        projectStage: input.projectStage?.trim() || null,
        notes: input.notes?.trim() || null,
        estimatedPrice: resolvedPrice || null,
        status: StudioBookingStatus.PENDING,
      },
      include: {
        offer: true,
      },
    });

    // Créer une notification in-app si l'utilisateur est connecté
    if (userId) {
      try {
        await prisma.notification.create({
          data: {
            userId,
            title: "🎙️ Demande de session Studio reçue",
            body: `Votre demande de réservation (${booking.reference}) a bien été transmise à l'équipe Bamako Podcast. Nous vous contacterons sous 24h pour confirmer votre créneau.`,
            link: "/tarifs",
            type: "STUDIO_BOOKING_RECEIVED",
          },
        });
      } catch (err) {
        console.error("Erreur lors de la création de notification pour StudioBooking:", err);
      }
    }

    return booking;
  }

  static async getMyBookings(userId: string) {
    return prisma.studioBooking.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        offer: true,
      },
    });
  }

  static async getBookingByReference(reference: string) {
    return prisma.studioBooking.findUnique({
      where: { reference },
      include: {
        offer: true,
      },
    });
  }

  static async adminListBookings(params: {
    status?: StudioBookingStatus;
    needType?: StudioBookingNeed;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.needType) where.needType = params.needType;
    if (params.search) {
      const q = params.search.trim();
      where.OR = [
        { reference: { contains: q, mode: "insensitive" } },
        { contactName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
        { podcastName: { contains: q, mode: "insensitive" } },
        { company: { contains: q, mode: "insensitive" } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.studioBooking.count({ where }),
      prisma.studioBooking.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          offer: true,
          user: {
            select: { id: true, fullName: true, email: true, avatar: true },
          },
        },
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  static async adminUpdateBookingStatus(
    id: string,
    data: {
      status?: StudioBookingStatus;
      adminNotes?: string;
    }
  ) {
    const booking = await prisma.studioBooking.update({
      where: { id },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.adminNotes !== undefined ? { adminNotes: data.adminNotes } : {}),
      },
      include: {
        offer: true,
        user: true,
      },
    });

    // Notifier l'utilisateur en cas de confirmation
    if (booking.userId && data.status) {
      let title = "";
      let body = "";

      if (data.status === StudioBookingStatus.CONFIRMED) {
        title = "✅ Réservation Studio confirmée !";
        body = `Votre session studio (${booking.reference}) a été confirmée par l'équipe. Consultez vos emails ou WhatsApp pour les consignes d'accès.`;
      } else if (data.status === StudioBookingStatus.CANCELLED) {
        title = "❌ Demande Studio annulée";
        body = `Votre demande (${booking.reference}) a été annulée. Contactez notre support pour plus d'informations.`;
      }

      if (title) {
        try {
          await prisma.notification.create({
            data: {
              userId: booking.userId,
              title,
              body,
              link: "/tarifs",
              type: "STUDIO_BOOKING_STATUS_CHANGE",
            },
          });
        } catch (err) {
          console.error("Erreur lors de la notification Studio:", err);
        }
      }
    }

    return booking;
  }
}
