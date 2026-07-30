import { Response } from "express";
import { AdminDashboardService } from "./admin-dashboard.service.js";
import { AdminCatalogService } from "./admin-catalog.service.js";
import { AdminPersonService } from "./admin-person.service.js";
import { AdminOrganizationService } from "./admin-organization.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import { prisma } from "../../config/prisma.js";

export class AdminController {
  static async getDashboard(req: AuthenticatedRequest, res: Response) {
    try {
      const data = await AdminDashboardService.getDashboardMetrics();
      return sendSuccess(res, data);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getCatalog(req: AuthenticatedRequest, res: Response) {
    try {
      const { countryId, languageCode, categoryId, status, ownershipStatus, creationSource, search, page, limit } = req.query;
      const data = await AdminCatalogService.getCatalog({
        countryId: countryId as string,
        languageCode: languageCode as string,
        categoryId: categoryId as string,
        status: status as any,
        ownershipStatus: ownershipStatus as any,
        creationSource: creationSource as any,
        search: search as string,
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? parseInt(limit as string, 10) : 20,
      });
      return sendSuccess(res, data);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async createPodcast(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const podcast = await AdminCatalogService.createAdminPodcast(req.user.id, req.body);
      return sendSuccess(res, podcast, null, 201);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async addFromUrlPreview(req: AuthenticatedRequest, res: Response) {
    try {
      const { url } = req.body;
      if (!url) return sendError(res, "URL requise", "VALIDATION_ERROR", 400);
      const preview = await AdminCatalogService.addFromUrlPreview(url);
      return sendSuccess(res, preview);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async detectDuplicates(req: AuthenticatedRequest, res: Response) {
    try {
      const { name, rssUrl } = req.body;
      const matches = await AdminCatalogService.detectDuplicates(name, rssUrl);
      return sendSuccess(res, matches);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async mergePodcasts(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { primaryId, duplicateId } = req.body;
      const result = await AdminCatalogService.mergePodcasts(req.user.id, primaryId, duplicateId);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getContentHealth(req: AuthenticatedRequest, res: Response) {
    try {
      const health = await AdminCatalogService.getContentHealth();
      return sendSuccess(res, health);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  // --- PERSONNES ---
  static async listPeople(req: AuthenticatedRequest, res: Response) {
    try {
      const people = await AdminPersonService.listPeople(req.query.search as string);
      return sendSuccess(res, people);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async createPerson(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const person = await AdminPersonService.createPerson(req.user.id, req.body);
      return sendSuccess(res, person, null, 201);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async mergePeople(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return sendError(res, "Non autorisé", "UNAUTHORIZED", 401);
      const { primaryId, duplicateId } = req.body;
      const result = await AdminPersonService.mergePeople(req.user.id, primaryId, duplicateId);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  // --- ORGANISATIONS ---
  static async listOrganizations(req: AuthenticatedRequest, res: Response) {
    try {
      const orgs = await AdminOrganizationService.listOrganizations();
      return sendSuccess(res, orgs);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async createOrganization(req: AuthenticatedRequest, res: Response) {
    try {
      const org = await AdminOrganizationService.createOrganization(req.body);
      return sendSuccess(res, org, null, 201);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  // --- AUDIT LOGS ---
  static async getAuditLogs(req: AuthenticatedRequest, res: Response) {
    try {
      const logs = await prisma.auditLog.findMany({
        take: 50,
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { id: true, fullName: true, email: true } } },
      });
      return sendSuccess(res, logs);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
