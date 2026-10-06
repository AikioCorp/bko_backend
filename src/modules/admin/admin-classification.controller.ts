import { Request, Response } from "express";
import { prisma } from "../../config/prisma.js";

// Utility to standardise success/error responses
const sendSuccess = (res: Response, data: any) => res.status(200).json({ success: true, data });
const sendError = (res: Response, message: string, code = 400) => res.status(code).json({ success: false, error: message });

export class AdminClassificationController {
  
  // --- Categories ---
  static async listCategories(req: Request, res: Response) {
    try {
      const categories = await prisma.category.findMany({
        orderBy: { name: "asc" },
        include: {
          _count: {
            select: { podcasts: true }
          }
        }
      });
      return sendSuccess(res, categories);
    } catch (e: any) {
      return sendError(res, e.message);
    }
  }

  static async createCategory(req: Request, res: Response) {
    try {
      const { name, slug, description, icon, isActive } = req.body;
      if (!name || !slug) return sendError(res, "Name and slug are required");

      const existing = await prisma.category.findUnique({ where: { slug } });
      if (existing) return sendError(res, "A category with this slug already exists");

      const category = await prisma.category.create({
        data: {
          name,
          slug,
          description,
          icon,
          isActive: isActive !== undefined ? isActive : true
        }
      });
      return sendSuccess(res, category);
    } catch (e: any) {
      return sendError(res, e.message);
    }
  }

  static async updateCategory(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { name, slug, description, icon, isActive } = req.body;

      const category = await prisma.category.update({
        where: { id },
        data: {
          name,
          slug,
          description,
          icon,
          isActive
        }
      });
      return sendSuccess(res, category);
    } catch (e: any) {
      return sendError(res, e.message);
    }
  }


  static async deleteCategory(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const count = await prisma.podcastCategory.count({ where: { categoryId: id } });
      if (count > 0) return sendError(res, "Impossible de supprimer une catégorie associée à des podcasts.");
      
      await prisma.category.delete({ where: { id } });
      return sendSuccess(res, { deleted: true });
    } catch (e: any) {
      return sendError(res, e.message);
    }
  }

  // --- Languages ---
  static async listLanguages(req: Request, res: Response) {
    try {
      const languages = await prisma.language.findMany({
        orderBy: { name: "asc" },
        include: {
          _count: {
            select: { primaryPodcasts: true, secondaryPodcasts: true }
          }
        }
      });
      return sendSuccess(res, languages);
    } catch (e: any) {
      return sendError(res, e.message);
    }
  }

  static async createLanguage(req: Request, res: Response) {
    try {
      const { code, name, nativeName, isActive } = req.body;
      if (!code || !name || !nativeName) return sendError(res, "Code, name and nativeName are required");

      const existing = await prisma.language.findUnique({ where: { code } });
      if (existing) return sendError(res, "A language with this code already exists");

      const language = await prisma.language.create({
        data: {
          code,
          name,
          nativeName,
          isActive: isActive !== undefined ? isActive : true
        }
      });
      return sendSuccess(res, language);
    } catch (e: any) {
      return sendError(res, e.message);
    }
  }

  static async updateLanguage(req: Request, res: Response) {
    try {
      const { code } = req.params;
      const { name, nativeName, isActive } = req.body;

      const language = await prisma.language.update({
        where: { code },
        data: {
          name,
          nativeName,
          isActive
        }
      });
      return sendSuccess(res, language);
    } catch (e: any) {
      return sendError(res, e.message);
    }
  }

  static async deleteLanguage(req: Request, res: Response) {
    try {
      const { code } = req.params;
      const primaryCount = await prisma.podcast.count({ where: { primaryLanguageCode: code } });
      const secondaryCount = await prisma.podcastLanguage.count({ where: { languageCode: code } });
      if (primaryCount > 0 || secondaryCount > 0) return sendError(res, "Impossible de supprimer une langue associée à des podcasts.");
      
      await prisma.language.delete({ where: { code } });
      return sendSuccess(res, { deleted: true });
    } catch (e: any) {
      return sendError(res, e.message);
    }
  }
}
