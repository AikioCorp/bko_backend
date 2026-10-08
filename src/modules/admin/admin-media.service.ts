import { prisma } from "../../config/prisma.js";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.S3_REGION || "auto",
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

export class AdminMediaService {
  static async listMedia(page: number = 1, limit: number = 20, search: string = "") {
    const where: any = {};
    if (search) {
      where.OR = [
        { key: { contains: search, mode: "insensitive" } },
        { mimeType: { contains: search, mode: "insensitive" } }
      ];
    }
    
    const [data, total] = await Promise.all([
      prisma.mediaAsset.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          owner: { select: { name: true, email: true } }
        }
      }),
      prisma.mediaAsset.count({ where })
    ]);
    return { data, total, page, limit };
  }
  
  static async deleteMedia(id: string) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new Error("Fichier introuvable");
    
    // Delete from S3
    try {
      await s3.send(new DeleteObjectCommand({
        Bucket: asset.bucket,
        Key: asset.key
      }));
    } catch (e) {
      console.error("Failed to delete from S3:", e);
    }
    
    await prisma.mediaAsset.delete({ where: { id } });
    return { success: true };
  }
}
