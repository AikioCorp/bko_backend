import { Request, Response } from "express";
import { MarketService } from "./market.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

export class MarketController {
  // --- ENDPOINTS PUBLICS ---
  static async getPublicMarkets(req: Request, res: Response) {
    try {
      const markets = await MarketService.getPublicMarkets();
      return sendSuccess(res, markets);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async requestBetaAccess(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { countryCode } = req.body;
      const profile = await req.user.id; // Obtenir profil créateur
      const access = await MarketService.requestBetaAccess(profile, countryCode);
      return sendSuccess(res, access, null, 201);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  // --- ENDPOINTS ADMIN ---
  static async getAdminMarkets(req: AuthenticatedRequest, res: Response) {
    try {
      const markets = await MarketService.getAdminMarkets();
      return sendSuccess(res, markets);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getMarketByCountryCode(req: AuthenticatedRequest, res: Response) {
    try {
      const market = await MarketService.getMarketByCountryCode(req.params.countryCode.toUpperCase());
      if (!market) return sendError(res, "Marché non trouvé", "NOT_FOUND", 404);
      return sendSuccess(res, market);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async updateMarket(req: AuthenticatedRequest, res: Response) {
    try {
      const updated = await MarketService.updateMarket(req.params.countryCode.toUpperCase(), req.body);
      return sendSuccess(res, updated);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async activateMarket(req: AuthenticatedRequest, res: Response) {
    try {
      const updated = await MarketService.updateMarket(req.params.countryCode.toUpperCase(), {
        status: "ACTIVE",
        discoveryEnabled: true,
        creatorSignupEnabled: true,
        podcastCreationEnabled: true,
        publishingEnabled: true,
        uploadEnabled: true,
        rssImportEnabled: true,
      });
      return sendSuccess(res, updated);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async suspendMarket(req: AuthenticatedRequest, res: Response) {
    try {
      const updated = await MarketService.updateMarket(req.params.countryCode.toUpperCase(), {
        status: "SUSPENDED",
        creatorSignupEnabled: false,
        podcastCreationEnabled: false,
        publishingEnabled: false,
        uploadEnabled: false,
      });
      return sendSuccess(res, updated);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async updateCreatorAccess(req: AuthenticatedRequest, res: Response) {
    try {
      const { status } = req.body;
      const updated = await MarketService.updateCreatorAccess(req.params.id, status, req.user?.id);
      return sendSuccess(res, updated);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
