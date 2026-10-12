import { Request, Response } from "express";
import { AdService } from "./ad.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { z } from "zod";

const AdvertiserInquirySchema = z.object({
  company: z.string().min(2, "Le nom de l'entreprise est requis"),
  contactName: z.string().min(2, "Le nom du contact est requis"),
  email: z.string().email("Adresse email invalide"),
  phone: z.string().optional().nullable(),
  targetPeriod: z.string().optional().nullable(),
  budget: z.string().optional().nullable(),
  message: z.string().min(5, "Le message doit comporter au moins 5 caractères"),
});

export class AdController {
  /**
   * Endpoint public : récupérer les bannières actives pour un emplacement.
   */
  static async getActiveAds(req: Request, res: Response) {
    try {
      const placement = (req.query.placement as string) || "EXPLORE_CATALOG";
      const ads = await AdService.getActiveAds(placement);
      return sendSuccess(res, ads);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la récupération des bannières.");
    }
  }

  /**
   * Endpoint public : enregistrement d'une impression (au moment de la visibilité réelle).
   */
  static async recordImpression(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await AdService.recordImpression(id);
      if (!result) return sendError(res, "Campagne introuvable", "NOT_FOUND", 404);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de l'enregistrement de l'impression.");
    }
  }

  /**
   * Endpoint public : enregistrement d'un clic.
   */
  static async recordClick(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await AdService.recordClick(id);
      if (!result) return sendError(res, "Campagne introuvable", "NOT_FOUND", 404);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de l'enregistrement du clic.");
    }
  }

  /**
   * Endpoint public : soumission du formulaire "Annoncer sur Bamako Podcast".
   */
  static async submitInquiry(req: Request, res: Response) {
    try {
      const parsed = AdvertiserInquirySchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, parsed.error.errors[0]?.message || "Données invalides", "VALIDATION_ERROR", 400);
      }

      const inquiry = await AdService.createInquiry(parsed.data as any);
      return sendSuccess(res, { id: inquiry.id, message: "Votre demande a été bien enregistrée. Notre équipe vous contactera rapidement." });
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de l'enregistrement de votre demande.");
    }
  }

  // ================= ADMIN CONTROLLER METHODS =================

  static async listAdminCampaigns(req: Request, res: Response) {
    try {
      const campaigns = await AdService.listAllCampaigns();
      return sendSuccess(res, campaigns);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la récupération des campagnes.");
    }
  }

  static async createAdminCampaign(req: Request, res: Response) {
    try {
      const {
        advertiserName,
        contactName,
        contactEmail,
        contactPhone,
        title,
        description,
        ctaLabel,
        targetUrl,
        imageUrlDesktop,
        imageUrlMobile,
        altText,
        placement,
        isSponsored,
        status,
        priority,
        startsAt,
        endsAt,
      } = req.body;

      if (!advertiserName || !title || !targetUrl || !imageUrlDesktop) {
        return sendError(res, "Nom annonceur, titre, URL cible et image desktop sont obligatoires.", "VALIDATION_ERROR", 400);
      }

      const campaign = await AdService.createCampaign({
        advertiserName,
        contactName,
        contactEmail,
        contactPhone,
        title,
        description,
        ctaLabel,
        targetUrl,
        imageUrlDesktop,
        imageUrlMobile,
        altText,
        placement,
        isSponsored,
        status,
        priority,
        startsAt,
        endsAt,
      });

      return sendSuccess(res, campaign, undefined, 201);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la création de la campagne.");
    }
  }

  static async updateAdminCampaign(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const campaign = await AdService.updateCampaign(id, req.body);
      return sendSuccess(res, campaign);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la mise à jour de la campagne.");
    }
  }

  static async deleteAdminCampaign(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await AdService.deleteCampaign(id);
      return sendSuccess(res, { deleted: true });
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la suppression de la campagne.");
    }
  }

  static async listAdminInquiries(req: Request, res: Response) {
    try {
      const inquiries = await AdService.listAllInquiries();
      return sendSuccess(res, inquiries);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la récupération des demandes annonceurs.");
    }
  }

  static async updateAdminInquiry(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;
      const inquiry = await AdService.updateInquiryStatus(id, status, notes);
      return sendSuccess(res, inquiry);
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la mise à jour de la demande.");
    }
  }
}
