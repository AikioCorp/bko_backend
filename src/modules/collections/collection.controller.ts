import { Request, Response } from "express";
import { CollectionService } from "./collection.service.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

export class CollectionController {
  static async listCollections(req: Request, res: Response) {
    try {
      const collections = await CollectionService.listCollections();
      return sendSuccess(res, collections);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async getCollectionBySlug(req: Request, res: Response) {
    try {
      const collection = await CollectionService.getCollectionBySlug(req.params.slug);
      if (!collection) return sendError(res, "Collection introuvable", "NOT_FOUND", 404);
      return sendSuccess(res, collection);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async createCollection(req: AuthenticatedRequest, res: Response) {
    try {
      const collection = await CollectionService.createCollection(req.body);
      return sendSuccess(res, collection, null, 201);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }

  static async updateCollectionItems(req: AuthenticatedRequest, res: Response) {
    try {
      const result = await CollectionService.updateCollectionItems(req.params.id, req.body.items);
      return sendSuccess(res, result);
    } catch (error: any) {
      return sendError(res, error.message);
    }
  }
}
