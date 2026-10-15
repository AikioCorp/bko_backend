import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

const suggestSchema = z.object({
  name: z.string().min(2, "Le nom du podcast, créateur ou radio est requis"),
  sourceUrl: z.string().optional().or(z.literal("")),
  details: z.string().optional().or(z.literal("")),
});

export class ShowSuggestionController {
  static async submitSuggestion(req: Request, res: Response) {
    try {
      const parsed = suggestSchema.parse(req.body);
      const userId = (req as AuthenticatedRequest).user?.id || null;

      const suggestion = await prisma.showSuggestion.create({
        data: {
          name: parsed.name.trim(),
          sourceUrl: parsed.sourceUrl?.trim() || null,
          details: parsed.details?.trim() || null,
          userId,
          status: "PENDING",
        },
      });

      return sendSuccess(res, suggestion, "Suggestion transmise avec succès à l'équipe éditoriale", 201);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return sendError(res, "Données invalides", "VALIDATION_ERROR", 400, error.flatten().fieldErrors);
      }
      return sendError(res, error.message || "Impossible d'enregistrer votre proposition.");
    }
  }

  static async adminListSuggestions(req: Request, res: Response) {
    try {
      const { status, search, page, limit } = req.query;
      const p = page ? parseInt(page as string, 10) : 1;
      const l = limit ? parseInt(limit as string, 10) : 20;
      const skip = (p - 1) * l;

      const where: any = {};
      if (status) where.status = status as string;
      if (search) {
        where.name = { contains: search as string, mode: "insensitive" };
      }

      const [total, items] = await Promise.all([
        prisma.showSuggestion.count({ where }),
        prisma.showSuggestion.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: l,
          include: {
            user: {
              select: { id: true, fullName: true, email: true, avatar: true },
            },
          },
        }),
      ]);

      return sendSuccess(res, {
        items,
        total,
        page: p,
        limit: l,
        totalPages: Math.ceil(total / l),
      });
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la récupération des suggestions");
    }
  }

  static async adminUpdateStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (!status) return sendError(res, "Statut requis", "MISSING_STATUS", 400);

      const updated = await prisma.showSuggestion.update({
        where: { id },
        data: { status },
      });

      return sendSuccess(res, updated, "Statut de la suggestion mis à jour");
    } catch (error: any) {
      return sendError(res, error.message || "Erreur lors de la mise à jour");
    }
  }
}
