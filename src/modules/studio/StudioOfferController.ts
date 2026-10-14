import { Request, Response } from "express";
import { prisma } from "../../config/prisma.js";

export class StudioOfferController {
  // --- PUBLIC METHODS ---
  // Récupérer toutes les offres actives pour le site public
  static async getActiveOffers(req: Request, res: Response) {
    try {
      const offers = await prisma.studioOffer.findMany({
        where: { isActive: true },
        orderBy: { order: "asc" },
      });
      res.json({ success: true, data: offers });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  }

  // --- ADMIN METHODS ---
  // Récupérer toutes les offres (actives et inactives)
  static async getAllOffers(req: Request, res: Response) {
    try {
      const offers = await prisma.studioOffer.findMany({
        orderBy: { order: "asc" },
      });
      res.json({ success: true, data: offers });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  }

  // Créer une nouvelle offre
  static async createOffer(req: Request, res: Response) {
    try {
      const { type, name, price, unit, description, features, isPopular, iconName, isActive, order } = req.body;
      const newOffer = await prisma.studioOffer.create({
        data: {
          type,
          name,
          price,
          unit,
          description,
          features: Array.isArray(features) ? features : [],
          isPopular: isPopular || false,
          iconName,
          isActive: isActive !== undefined ? Boolean(isActive) : true,
          order: order !== undefined ? Number(order) : 0,
        },
      });
      res.status(201).json({ success: true, data: newOffer });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  }

  // Mettre à jour une offre
  static async updateOffer(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { type, name, price, unit, description, features, isPopular, iconName, isActive, order } = req.body;
      const updatedOffer = await prisma.studioOffer.update({
        where: { id },
        data: {
          ...(type !== undefined ? { type } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(price !== undefined ? { price } : {}),
          ...(unit !== undefined ? { unit } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(features !== undefined ? { features: Array.isArray(features) ? features : [] } : {}),
          ...(isPopular !== undefined ? { isPopular: Boolean(isPopular) } : {}),
          ...(iconName !== undefined ? { iconName } : {}),
          ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
          ...(order !== undefined ? { order: Number(order) } : {}),
        },
      });
      res.json({ success: true, data: updatedOffer });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  }

  // Supprimer une offre
  static async deleteOffer(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await prisma.studioOffer.delete({ where: { id } });
      res.json({ success: true, message: "Offre supprimée avec succès" });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  }
}
