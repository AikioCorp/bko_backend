import { prisma } from "../../config/prisma.js";
import { StudioBookingNeed, StudioBookingStatus } from "@prisma/client";
import { MailService } from "../../services/mail/mail.service.js";
import { generateStudioInvoicePdf } from "../../utils/pdf-invoice.js";

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

const ACTIVE_BOOKING_STATUSES: StudioBookingStatus[] = [
  StudioBookingStatus.PENDING,
  StudioBookingStatus.REVIEWING,
  StudioBookingStatus.CONFIRMED,
];

function slotsOverlap(a: string, b: string): boolean {
  if (a === "FLEXIBLE" || b === "FLEXIBLE") return false;
  if (a === b) return true;
  if (a === "JOURNEE" && (b === "MATIN" || b === "APRES_MIDI" || b === "SOIREE")) return true;
  if (b === "JOURNEE" && (a === "MATIN" || a === "APRES_MIDI" || a === "SOIREE")) return true;
  return false;
}

export class StudioBookingService {
  static async getBookedSlots(preferredDate: string, studioLocation?: string) {
    const cleanDate = preferredDate.trim();
    if (!cleanDate) return { date: cleanDate, bookedSlots: [] as string[], bookings: [] };

    const where: any = {
      preferredDate: cleanDate,
      status: { in: ACTIVE_BOOKING_STATUSES },
    };
    if (studioLocation && studioLocation.trim()) {
      where.studioLocation = studioLocation.trim();
    }

    const existing = await prisma.studioBooking.findMany({
      where,
      select: {
        timeSlot: true,
        studioLocation: true,
      },
    });

    const rawSlots = existing.map((b) => b.timeSlot).filter((s): s is string => Boolean(s));
    const expanded = new Set<string>();
    for (const slot of rawSlots) {
      if (slot === "FLEXIBLE") continue;
      expanded.add(slot);
      if (slot === "JOURNEE") {
        expanded.add("MATIN");
        expanded.add("APRES_MIDI");
        expanded.add("SOIREE");
      } else if (slot === "MATIN" || slot === "APRES_MIDI" || slot === "SOIREE") {
        expanded.add("JOURNEE");
      }
    }

    return {
      date: cleanDate,
      studioLocation: studioLocation?.trim() || null,
      bookedSlots: Array.from(expanded),
    };
  }

  static async createBooking(input: CreateBookingInput, userId?: string) {
    const cleanDate = input.preferredDate?.trim();
    const cleanSlot = input.timeSlot?.trim();
    const cleanLocation = input.studioLocation?.trim() || "STUDIO_PRINCIPAL";

    if (
      (input.needType === StudioBookingNeed.AUDIO_PODCAST ||
        input.needType === StudioBookingNeed.VIDEO_PODCAST) &&
      cleanDate &&
      cleanSlot &&
      cleanSlot !== "FLEXIBLE"
    ) {
      const sameDayBookings = await prisma.studioBooking.findMany({
        where: {
          preferredDate: cleanDate,
          studioLocation: cleanLocation,
          status: { in: ACTIVE_BOOKING_STATUSES },
        },
        select: { id: true, timeSlot: true },
      });

      const conflict = sameDayBookings.find(
        (b) => b.timeSlot && slotsOverlap(cleanSlot, b.timeSlot)
      );
      if (conflict) {
        const err: any = new Error(
          "Ce créneau est déjà réservé pour cet espace à cette date. Veuillez choisir un autre horaire ou un autre espace."
        );
        err.code = "SLOT_UNAVAILABLE";
        err.statusCode = 409;
        throw err;
      }
    }

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

    // Envoyer un email de confirmation de réception (non bloquant)
    try {
      const detailsLines = [
        `Bonjour ${booking.contactName},`,
        "",
        `Nous avons bien reçu votre demande de réservation Studio (${booking.reference}).`,
        booking.offer?.name ? `Formule : ${booking.offer.name}` : null,
        booking.preferredDate ? `Date souhaitée : ${booking.preferredDate}` : null,
        booking.timeSlot ? `Créneau : ${booking.timeSlot}` : null,
        booking.studioLocation ? `Espace : ${booking.studioLocation}` : null,
        booking.estimatedPrice ? `Tarif estimatif : ${booking.estimatedPrice}` : null,
        "",
        "Notre régisseur vérifie la disponibilité du studio et vous confirmera votre créneau sous 24h par email ou WhatsApp.",
        "",
        "L'équipe Bamako Podcast Studio",
      ].filter((l) => l !== null);

      await MailService.enqueue({
        to: booking.email,
        subject: `Demande Studio reçue — Référence ${booking.reference}`,
        text: detailsLines.join("\n"),
        html: `<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;background:#111;color:#fff;border-radius:12px;">
          <h2 style="color:#FFBF00;margin-top:0;">Demande de session Studio reçue</h2>
          <p>Bonjour <strong>${booking.contactName}</strong>,</p>
          <p>Nous avons bien enregistré votre demande sous la référence <strong style="color:#FFBF00;">${booking.reference}</strong>.</p>
          <ul style="line-height:1.8;color:#ccc;">
            ${booking.offer?.name ? `<li><strong>Formule :</strong> ${booking.offer.name}</li>` : ""}
            ${booking.preferredDate ? `<li><strong>Date souhaitée :</strong> ${booking.preferredDate}</li>` : ""}
            ${booking.timeSlot ? `<li><strong>Créneau :</strong> ${booking.timeSlot}</li>` : ""}
            ${booking.studioLocation ? `<li><strong>Espace :</strong> ${booking.studioLocation}</li>` : ""}
            ${booking.estimatedPrice ? `<li><strong>Tarif estimatif :</strong> ${booking.estimatedPrice}</li>` : ""}
          </ul>
          <p style="color:#aaa;font-size:13px;">Notre équipe vérifie la disponibilité et vous confirmera le créneau sous 24h.</p>
        </div>`,
      });
    } catch (err) {
      console.error("Erreur lors de la mise en file d'attente de l'email StudioBooking:", err);
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
      select: {
        id: true,
        reference: true,
        needType: true,
        podcastName: true,
        preferredDate: true,
        timeSlot: true,
        durationHours: true,
        participantsCount: true,
        studioLocation: true,
        estimatedPrice: true,
        currency: true,
        status: true,
        createdAt: true,
        updatedAt: true,
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

    // Envoyer un email lors de la confirmation ou annulation
    if (
      booking.email &&
      (data.status === StudioBookingStatus.CONFIRMED ||
        data.status === StudioBookingStatus.CANCELLED)
    ) {
      const isConfirmed = data.status === StudioBookingStatus.CONFIRMED;
      const subject = isConfirmed
        ? `Session Studio confirmée — ${booking.reference}`
        : `Mise à jour de votre demande Studio — ${booking.reference}`;
      const text = isConfirmed
        ? `Bonjour ${booking.contactName},\n\nVotre session studio (${booking.reference}) est confirmée !\nDate : ${booking.preferredDate || "À convenir"}\nCréneau : ${booking.timeSlot || "À convenir"}\nEspace : ${booking.studioLocation || "Studio Principal"}\n\nÀ très bientôt au studio Bamako Podcast.`
        : `Bonjour ${booking.contactName},\n\nVotre demande studio (${booking.reference}) a été annulée. N'hésitez pas à nous contacter sur WhatsApp ou par email pour replanifier un créneau.`;
      try {
        await MailService.enqueue({
          to: booking.email,
          subject,
          text,
          html: `<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;background:#111;color:#fff;border-radius:12px;">
            <h2 style="color:${isConfirmed ? "#10B981" : "#EF4444"};margin-top:0;">${subject}</h2>
            <p style="white-space:pre-line;color:#ddd;line-height:1.6;">${text}</p>
          </div>`,
        });
      } catch (err) {
        console.error("Erreur email mise à jour statut StudioBooking:", err);
      }
    }

    return booking;
  }

  static async cancelMyBooking(id: string, userId: string) {
    const existing = await prisma.studioBooking.findUnique({ where: { id } });
    if (!existing) {
      const err: any = new Error("Réservation introuvable");
      err.statusCode = 404;
      throw err;
    }
    if (existing.userId !== userId) {
      const err: any = new Error("Accès refusé à cette réservation");
      err.statusCode = 403;
      throw err;
    }
    if (
      existing.status !== StudioBookingStatus.PENDING &&
      existing.status !== StudioBookingStatus.REVIEWING
    ) {
      const err: any = new Error("Seule une demande en attente peut être annulée en ligne.");
      err.statusCode = 400;
      throw err;
    }
    return prisma.studioBooking.update({
      where: { id },
      data: { status: StudioBookingStatus.CANCELLED },
      include: { offer: true },
    });
  }

  static async payDeposit(
    id: string,
    userId: string,
    input: { depositAmount: number; paymentMethod: string }
  ) {
    const existing = await prisma.studioBooking.findUnique({
      where: { id },
      include: { offer: true },
    });
    if (!existing) throw new Error("Réservation introuvable");
    if (existing.userId && existing.userId !== userId) {
      throw new Error("Accès refusé à cette réservation");
    }
    if (existing.status === StudioBookingStatus.CANCELLED) {
      throw new Error("Impossible de régler un acompte sur une réservation annulée.");
    }
    if (existing.depositStatus === "PAID") {
      throw new Error("L'acompte a déjà été réglé pour cette réservation.");
    }

    const depositRef = `BKO-DEP-${Date.now().toString(36).toUpperCase()}`;
    const nextStatus =
      existing.status === StudioBookingStatus.PENDING ||
      existing.status === StudioBookingStatus.REVIEWING
        ? StudioBookingStatus.CONFIRMED
        : existing.status;

    const updated = await prisma.studioBooking.update({
      where: { id },
      data: {
        depositAmount: input.depositAmount,
        depositStatus: "PAID",
        depositMethod: input.paymentMethod,
        depositRef,
        depositPaidAt: new Date(),
        status: nextStatus,
      },
      include: { offer: true },
    });

    try {
      await prisma.notification.create({
        data: {
          userId,
          title: "✅ Acompte Studio validé — Créneau confirmé",
          body: `Votre acompte de ${input.depositAmount.toLocaleString("fr-FR")} FCFA (${depositRef}) pour ${updated.reference} est enregistré. Votre facture PDF est disponible.`,
          link: "/tarifs",
          type: "STUDIO_DEPOSIT_PAID",
        },
      });
    } catch (_) {}

    return updated;
  }

  static async getInvoicePdf(id: string, userId?: string, isAdmin = false) {
    const booking = await prisma.studioBooking.findUnique({
      where: { id },
      include: { offer: true },
    });
    if (!booking) throw new Error("Réservation introuvable");
    if (!isAdmin && booking.userId && booking.userId !== userId) {
      throw new Error("Accès refusé à cette facture");
    }

    const buffer = generateStudioInvoicePdf({
      reference: booking.reference,
      createdAt: booking.createdAt.toLocaleDateString("fr-FR"),
      contactName: booking.contactName,
      email: booking.email,
      phone: `${booking.countryCode || "+223"} ${booking.phone}`.trim(),
      company: booking.company,
      offerName: booking.offer?.name,
      needType: booking.needType,
      studioLocation: booking.studioLocation,
      preferredDate: booking.preferredDate,
      timeSlot: booking.timeSlot,
      durationHours: booking.durationHours,
      estimatedPrice: booking.estimatedPrice,
      depositAmount: booking.depositAmount,
      depositStatus: booking.depositStatus,
      depositMethod: booking.depositMethod,
      depositRef: booking.depositRef,
      status: booking.status,
    });

    return { reference: booking.reference, buffer };
  }

  static async adminSetDeliverables(
    id: string,
    input: { deliverablesUrl: string; deliverablesNote?: string }
  ) {
    const updated = await prisma.studioBooking.update({
      where: { id },
      data: {
        deliverablesUrl: input.deliverablesUrl.trim(),
        deliverablesNote: input.deliverablesNote?.trim() || null,
        deliveredAt: new Date(),
        status: StudioBookingStatus.COMPLETED,
      },
      include: { offer: true },
    });

    if (updated.userId) {
      try {
        await prisma.notification.create({
          data: {
            userId: updated.userId,
            title: "📦 Vos fichiers Studio sont prêts !",
            body: `Les livrables de votre session (${updated.reference}) sont disponibles au téléchargement dans votre espace réservations.`,
            link: "/tarifs",
            type: "STUDIO_DELIVERABLES_READY",
          },
        });
      } catch (_) {}
    }

    if (updated.email) {
      try {
        await MailService.enqueue({
          to: updated.email,
          subject: `Vos fichiers Studio sont prêts — ${updated.reference}`,
          text: `Bonjour ${updated.contactName},\n\nLes fichiers de votre session (${updated.reference}) sont disponibles :\n${updated.deliverablesUrl}\n${updated.deliverablesNote ? `\nNote du studio : ${updated.deliverablesNote}` : ""}\n\nMerci pour votre confiance !`,
          html: `<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;background:#111;color:#fff;border-radius:12px;">
            <h2 style="color:#FFBF00;">📦 Vos fichiers Studio sont prêts</h2>
            <p>Bonjour <strong>${updated.contactName}</strong>,</p>
            <p>Vos livrables pour la session <strong>${updated.reference}</strong> sont disponibles :</p>
            <p><a href="${updated.deliverablesUrl}" style="display:inline-block;padding:10px 18px;background:#FFBF00;color:#000;font-weight:bold;text-decoration:none;border-radius:8px;">Télécharger mes fichiers</a></p>
            ${updated.deliverablesNote ? `<p style="color:#ccc;font-size:13px;">${updated.deliverablesNote}</p>` : ""}
          </div>`,
        });
      } catch (_) {}
    }

    return updated;
  }
}
