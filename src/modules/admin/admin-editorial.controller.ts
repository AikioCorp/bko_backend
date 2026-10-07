import { Response } from "express";
import { AdminEditorialService, AdminEditorialError } from "./admin-editorial.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

export class AdminEditorialController {
  private static handleError(res: Response, e: any) {
    if (e instanceof AdminEditorialError) {
      return sendError(res, e.message, e.code, e.status);
    }
    return sendError(res, e.message || "Erreur interne", "INTERNAL_ERROR", 500);
  }

  // --- SECTIONS ---
  static async listSections(req: AuthenticatedRequest, res: Response) {
    try {
      const data = await AdminEditorialService.listSections();
      return sendSuccess(res, data);
    } catch (e) { return AdminEditorialController.handleError(res, e); }
  }

  static async getSection(req: AuthenticatedRequest, res: Response) {
    try {
      const data = await AdminEditorialService.getSection(req.params.id);
      if (!data) return sendError(res, "Section introuvable", "NOT_FOUND", 404);
      return sendSuccess(res, data);
    } catch (e) { return AdminEditorialController.handleError(res, e); }
  }

  static async createSection(req: AuthenticatedRequest, res: Response) {
    try {
      const data = await AdminEditorialService.createSection(req.body);
      return sendSuccess(res, data, "Section créée", 201);
    } catch (e) { return AdminEditorialController.handleError(res, e); }
  }

  static async updateSection(req: AuthenticatedRequest, res: Response) {
    try {
      const data = await AdminEditorialService.updateSection(req.params.id, req.body);
      return sendSuccess(res, data, "Section mise à jour");
    } catch (e) { return AdminEditorialController.handleError(res, e); }
  }

  static async reorderSections(req: AuthenticatedRequest, res: Response) {
    try {
      await AdminEditorialService.updateSectionsOrder(req.body.ids);
      return sendSuccess(res, null, "Ordre mis à jour");
    } catch (e) { return AdminEditorialController.handleError(res, e); }
  }

  static async addSectionItem(req: AuthenticatedRequest, res: Response) {
    try {
      const data = await AdminEditorialService.addSectionItem(req.params.id, req.body);
      return sendSuccess(res, data, "Élément ajouté");
    } catch (e) { return AdminEditorialController.handleError(res, e); }
  }

  static async removeSectionItem(req: AuthenticatedRequest, res: Response) {
    try {
      await AdminEditorialService.removeSectionItem(req.params.itemId);
      return sendSuccess(res, null, "Élément retiré");
    } catch (e) { return AdminEditorialController.handleError(res, e); }
  }

  static async reorderSectionItems(req: AuthenticatedRequest, res: Response) {
    try {
      await AdminEditorialService.updateSectionItemsOrder(req.params.id, req.body.ids);
      return sendSuccess(res, null, "Ordre mis à jour");
    } catch (e) { return AdminEditorialController.handleError(res, e); }
  }

  // --- COLLECTIONS ---
  static async listCollections(req: AuthenticatedRequest, res: Response) {
    try {
      const data = await AdminEditorialService.listCollections();
      return sendSuccess(res, data);
    } catch (e) { return AdminEditorialController.handleError(res, e); }
  }

  static async getCollection(req: AuthenticatedRequest, res: Response) {
    try {
      const data = await AdminEditorialService.getCollection(req.params.id);
      if (!data) return sendError(res, "Collection introuvable", "NOT_FOUND", 404);
      return sendSuccess(res, data);
    } catch (e) { return AdminEditorialController.handleError(res, e); }
  }

  static async createCollection(req: AuthenticatedRequest, res: Response) {
    try {
      const data = await AdminEditorialService.createCollection(req.body);
      return sendSuccess(res, data, "Collection créée", 201);
    } catch (e) { return AdminEditorialController.handleError(res, e); }
  }

  static async updateCollection(req: AuthenticatedRequest, res: Response) {
    try {
      const data = await AdminEditorialService.updateCollection(req.params.id, req.body);
      return sendSuccess(res, data, "Collection mise à jour");
    } catch (e) { return AdminEditorialController.handleError(res, e); }
  }

  static async addCollectionItem(req: AuthenticatedRequest, res: Response) {
    try {
      const data = await AdminEditorialService.addCollectionItem(req.params.id, req.body);
      return sendSuccess(res, data, "Élément ajouté");
    } catch (e) { return AdminEditorialController.handleError(res, e); }
  }

  static async removeCollectionItem(req: AuthenticatedRequest, res: Response) {
    try {
      await AdminEditorialService.removeCollectionItem(req.params.itemId);
      return sendSuccess(res, null, "Élément retiré");
    } catch (e) { return AdminEditorialController.handleError(res, e); }
  }

  static async reorderCollectionItems(req: AuthenticatedRequest, res: Response) {
    try {
      await AdminEditorialService.updateCollectionItemsOrder(req.params.id, req.body.ids);
      return sendSuccess(res, null, "Ordre mis à jour");
    } catch (e) { return AdminEditorialController.handleError(res, e); }
  }
}
