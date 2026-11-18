import { Request, Response } from "express";
import { z } from "zod";
import { StudioBookingService } from "./studio-booking.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import { StudioBookingNeed, StudioBookingStatus } from "@prisma/client";

const createBookingSchema = z.object({
  needType: z.nativeEnum(StudioBookingNeed),
  offerId: z.string().optional(),
  contactName: z.string().min(2, "Le nom du contact est obligatoire"),
  podcastName: z.string().optional(),
  company: z.string().optional(),
  email: z.string().email("Adresse email invalide"),
  phone: z.string().min(6, "Numéro de téléphone invalide"),
  countryCode: z.string().default("+223"),
  preferredDate: z.string().optional(),
  timeSlot: z.string().optional(),
  durationHours: z.number().optional(),
  participantsCount: z.number().optional(),
  studioLocation: z.string().optional(),
  shootingNeeds: z.string().optional(),
  mediaFilesUrl: z.string().optional(),
  targetDeadline: z.string().optional(),
  expectedResult: z.string().optional(),
  snippetsCount: z.number().optional(),
  aspectRatios: z.array(z.string()).optional(),
  subtitlesNeeded: z.boolean().optional(),
  coachingGoal: z.string().optional(),
  projectStage: z.string().optional(),
  notes: z.string().optional(),
  estimatedPrice: z.string().optional(),
});

const updateStatusSchema = z.object({
  status: z.nativeEnum(StudioBookingStatus).optional(),
  adminNotes: z.string().optional(),
});

export class StudioBookingController {
  static async getAvailability(req: Request, res: Response) {
    try {
      const date = typeof req.query.date === "string" ? req.query.date : "";
      const studioLocation =
        typeof req.query.studioLocation === "string" ? req.query.studioLocation : undefined;
      if (!date) {
        return sendError(res, "Paramètre date requis (YYYY-MM-DD)", "MISSING_PARAM", 400);
      }
      const data = await StudioBookingService.getBookedSlots(date, studioLocation);
      return sendSuccess(res, data);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la vérification des disponibilités");
    }
  }

  static async submitBooking(req: Request, res: Response) {
    try {
      const parsed = createBookingSchema.parse(req.body);
      const userId = (req as AuthenticatedRequest).user?.id;
      const booking = await StudioBookingService.createBooking(parsed, userId);
      return sendSuccess(res, booking, "Demande Studio enregistrée avec succès", 201);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return sendError(res, "Données de formulaire invalides", "VALIDATION_ERROR", 400, error.flatten().fieldErrors);
      }
      if (error?.code === "SLOT_UNAVAILABLE" || error?.statusCode === 409) {
        return sendError(res, error.message, "SLOT_UNAVAILABLE", 409);
      }
      if (error?.code === "INVALID_BOOKING_DAY" || error?.statusCode === 400) {
        return sendError(res, error.message, error?.code || "VALIDATION_ERROR", 400);
      }
      return sendError(res, error.message || "Erreur lors de l'enregistrement de votre demande Studio");
    }
  }

  static async getMyBookings(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Authentification requise", "UNAUTHORIZED", 401);
      const bookings = await StudioBookingService.getMyBookings(req.user.id);
      return sendSuccess(res, bookings);
    } catch (error: any) {
      return sendError(res, error.message || "Impossible de récupérer vos réservations");
    }
  }

  static async cancelMyBooking(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Authentification requise", "UNAUTHORIZED", 401);
      const updated = await StudioBookingService.cancelMyBooking(req.params.id, req.user.id);
      return sendSuccess(res, updated, "Demande annulée avec succès");
    } catch (error: any) {
      return sendError(
        res,
        error.message || "Impossible d'annuler cette réservation",
        "CANCEL_ERROR",
        error?.statusCode || 400
      );
    }
  }

  static async payDeposit(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Authentification requise", "UNAUTHORIZED", 401);
      const depositAmount = Number(req.body?.depositAmount);
      const paymentMethod =
        typeof req.body?.paymentMethod === "string" ? req.body.paymentMethod : "ORANGE_MONEY";
      if (!Number.isFinite(depositAmount) || depositAmount < 1000) {
        return sendError(res, "Montant d'acompte invalide (min. 1 000 FCFA)", "INVALID_AMOUNT", 400);
      }
      const updated = await StudioBookingService.payDeposit(req.params.id, req.user.id, {
        depositAmount: Math.round(depositAmount),
        paymentMethod,
      });
      return sendSuccess(res, updated, "Acompte validé et créneau confirmé !");
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors du paiement de l'acompte", "DEPOSIT_ERROR", 400);
    }
  }

  static async downloadInvoice(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Authentification requise", "UNAUTHORIZED", 401);
      const isAdmin = (req.user.roles || []).some((r: string) =>
        ["ADMIN", "SUPER_ADMIN"].includes(r.toUpperCase())
      );
      const { reference, buffer } = await StudioBookingService.getInvoicePdf(
        req.params.id,
        req.user.id,
        isAdmin
      );
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="facture-${reference}.pdf"`);
      return res.send(buffer);
    } catch (error: any) {
      return sendError(res, error.message || "Impossible de générer la facture", "INVOICE_ERROR", 400);
    }
  }

  static async adminSetDeliverables(req: Request, res: Response) {
    try {
      const deliverablesUrl =
        typeof req.body?.deliverablesUrl === "string" ? req.body.deliverablesUrl : "";
      const deliverablesNote =
        typeof req.body?.deliverablesNote === "string" ? req.body.deliverablesNote : undefined;
      if (!deliverablesUrl.trim()) {
        return sendError(res, "URL des fichiers livrables requise", "MISSING_URL", 400);
      }
      const updated = await StudioBookingService.adminSetDeliverables(req.params.id, {
        deliverablesUrl,
        deliverablesNote,
      });
      return sendSuccess(res, updated, "Livrables enregistrés et client notifié !");
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de l'ajout des livrables");
    }
  }

  static async getBookingByReference(req: Request, res: Response) {
    try {
      const { reference } = req.params;
      if (!reference) return sendError(res, "Référence requise", "MISSING_PARAM", 400);
      const booking = await StudioBookingService.getBookingByReference(reference);
      if (!booking) return sendError(res, "Réservation introuvable", "NOT_FOUND", 404);
      return sendSuccess(res, booking);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la recherche de la réservation");
    }
  }

  static async adminListBookings(req: Request, res: Response) {
    try {
      const { status, needType, search, page, limit } = req.query;
      const result = await StudioBookingService.adminListBookings({
        status: status as StudioBookingStatus,
        needType: needType as StudioBookingNeed,
        search: search as string,
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? parseInt(limit as string, 10) : 20,
      });
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors du listing des demandes Studio");
    }
  }

  static async adminUpdateBooking(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const parsed = updateStatusSchema.parse(req.body);
      const updated = await StudioBookingService.adminUpdateBookingStatus(id, parsed);
      return sendSuccess(res, updated, "Demande mise à jour avec succès");
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return sendError(res, "Données invalides", "VALIDATION_ERROR", 400, error.flatten().fieldErrors);
      }
      return sendError(res, error.message || "Erreur lors de la mise à jour de la demande Studio");
    }
  }
}
