import { Request, Response } from "express";
import { AdminMediaService } from "./admin-media.service.js";
import { sendSuccess } from "../../utils/response.js";

export class AdminMediaController {
  static async list(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const search = (req.query.search as string) || "";
      const result = await AdminMediaService.listMedia(page, limit, search);
      
      const serializedData = result.data.map((item: any) => ({
        ...item,
        sizeBytes: item.sizeBytes ? Number(item.sizeBytes) : 0
      }));
      
      res.json({ success: true, data: serializedData, total: result.total, page: result.page, limit: result.limit });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  static async remove(req: Request, res: Response) {
    try {
      await AdminMediaService.deleteMedia(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }
}
