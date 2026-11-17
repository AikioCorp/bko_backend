import { Request, Response } from "express";
import { z } from "zod";
import { MonetizationService } from "./monetization.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

const tipSchema = z.object({
  episodeId: z.string().optional(),
  supporterName: z.string().min(2, "Votre nom est requis"),
  supporterEmail: z.string().email("Email invalide").optional().or(z.literal("")),
  message: z.string().max(300).optional(),
  amount: z.number().int().min(500, "Montant minimum : 500 FCFA").max(1000000),
  paymentMethod: z.enum(["ORANGE_MONEY", "WAVE", "MOOV_MONEY", "CARD"]).default("ORANGE_MONEY"),
  phoneNumber: z.string().optional(),
});

const promoCreateSchema = z.object({
  code: z.string().min(3).max(32),
  description: z.string().optional(),
  discountType: z.enum(["PERCENT", "FIXED"]).default("PERCENT"),
  discountValue: z.number().int().min(1),
  maxUses: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
});

const giftPurchaseSchema = z.object({
  planId: z.string().min(1),
  recipientName: z.string().optional(),
  recipientEmail: z.string().email("Email destinataire invalide").optional().or(z.literal("")),
  message: z.string().max(300).optional(),
  paymentMethod: z.enum(["ORANGE_MONEY", "WAVE", "MOOV_MONEY", "CARD"]).default("ORANGE_MONEY"),
});

export class MonetizationController {
  static async createTip(req: Request, res: Response) {
    try {
      const parsed = tipSchema.parse(req.body);
      const userId = (req as AuthenticatedRequest).user?.id;
      const tip = await MonetizationService.createTip(req.params.id, parsed, userId);
      return sendSuccess(res, tip, "Merci pour votre soutien au créateur !", 201);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return sendError(res, "Données invalides", "VALIDATION_ERROR", 400, error.flatten().fieldErrors);
      }
      return sendError(res, error.message || "Erreur lors de l'envoi du soutien");
    }
  }

  static async getPodcastTips(req: Request, res: Response) {
    try {
      const data = await MonetizationService.getPodcastTips(req.params.id);
      return sendSuccess(res, data);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la récupération des soutiens");
    }
  }

  static async validatePromo(req: Request, res: Response) {
    try {
      const code = typeof req.body?.code === "string" ? req.body.code : "";
      const promo = await MonetizationService.validatePromoCode(code);
      return sendSuccess(res, promo, "Code promo valide");
    } catch (error: any) {
      return sendError(res, error.message || "Code promo invalide", "INVALID_PROMO", 400);
    }
  }

  static async adminListPromos(req: Request, res: Response) {
    try {
      const promos = await MonetizationService.listPromoCodes();
      return sendSuccess(res, promos);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async adminCreatePromo(req: Request, res: Response) {
    try {
      const parsed = promoCreateSchema.parse(req.body);
      const created = await MonetizationService.createPromoCode(parsed);
      return sendSuccess(res, created, "Code promo créé", 201);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return sendError(res, "Données invalides", "VALIDATION_ERROR", 400, error.flatten().fieldErrors);
      }
      return sendError(res, error.message || "Impossible de créer le code promo");
    }
  }

  static async purchaseGiftPass(req: Request, res: Response) {
    try {
      const parsed = giftPurchaseSchema.parse(req.body);
      const userId = (req as AuthenticatedRequest).user?.id;
      const gift = await MonetizationService.purchaseGiftPass(parsed, userId);
      return sendSuccess(res, gift, "Pass Cadeau généré avec succès", 201);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return sendError(res, "Données invalides", "VALIDATION_ERROR", 400, error.flatten().fieldErrors);
      }
      return sendError(res, error.message || "Erreur lors de la création du Pass Cadeau");
    }
  }

  static async redeemGiftPass(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Authentification requise", "UNAUTHORIZED", 401);
      const code = typeof req.body?.code === "string" ? req.body.code : "";
      if (!code) return sendError(res, "Code requis", "MISSING_CODE", 400);
      const result = await MonetizationService.redeemGiftPass(code, req.user.id);
      return sendSuccess(res, result, "Pass Cadeau activé avec succès !");
    } catch (error: any) {
      return sendError(res, error.message || "Impossible d'activer ce Pass Cadeau", "REDEEM_ERROR", 400);
    }
  }

  static async getMyGifts(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Authentification requise", "UNAUTHORIZED", 401);
      const gifts = await MonetizationService.getMyGiftPasses(req.user.id);
      return sendSuccess(res, gifts);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
