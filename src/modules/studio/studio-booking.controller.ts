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
