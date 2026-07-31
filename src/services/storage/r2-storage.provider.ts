import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { StorageProvider, PresignedUploadResult, ObjectMetadata } from "./storage.interface.js";

export class CloudflareR2StorageProvider implements StorageProvider {
  private s3Client: S3Client | null = null;
  private bucket: string;
  private publicBaseUrl: string;

  constructor() {
    this.bucket = process.env.R2_BUCKET_MEDIA || process.env.R2_BUCKET_NAME || "bamako-podcast-media";
    this.publicBaseUrl = process.env.R2_PUBLIC_BASE_URL || process.env.R2_PUBLIC_URL || "https://media.bamakopodcast.com";

    const endpoint = process.env.R2_ENDPOINT;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (endpoint && accessKeyId && secretAccessKey) {
      this.s3Client = new S3Client({
        region: "auto",
        endpoint,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    }
  }

  async createPresignedUploadUrl(
    storageKey: string,
    contentType: string,
    expiresInSeconds = 3600
  ): Promise<PresignedUploadResult> {
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    if (this.s3Client) {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        ContentType: contentType,
      });
      const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
      return { uploadUrl, storageKey, expiresAt };
    }

    // Fallback simulation mode en développement si les identifiants R2 ne sont pas encore configurés
    const uploadUrl = `${this.publicBaseUrl}/${storageKey}?mockUpload=true`;
    return { uploadUrl, storageKey, expiresAt };
  }

  async createPresignedDownloadUrl(storageKey: string): Promise<string> {
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl.replace(/\/$/, "")}/${storageKey}`;
    }
    return `https://${this.bucket}.r2.cloudflarestorage.com/${storageKey}`;
  }

  async objectExists(storageKey: string): Promise<boolean> {
    if (!this.s3Client) {
      return true; // Mode de dev local sans R2
    }
    try {
      const command = new HeadObjectCommand({ Bucket: this.bucket, Key: storageKey });
      await this.s3Client.send(command);
      return true;
    } catch (err: any) {
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  async getMetadata(storageKey: string): Promise<ObjectMetadata | null> {
    if (!this.s3Client) {
      return {
        sizeBytes: BigInt(1024 * 1024 * 8),
        contentType: "audio/mpeg",
        lastModified: new Date(),
      };
    }
    try {
      const command = new HeadObjectCommand({ Bucket: this.bucket, Key: storageKey });
      const res = await this.s3Client.send(command);
      return {
        sizeBytes: res.ContentLength ? BigInt(res.ContentLength) : BigInt(0),
        contentType: res.ContentType || "application/octet-stream",
        lastModified: res.LastModified || new Date(),
      };
    } catch (err: any) {
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async deleteObject(storageKey: string): Promise<void> {
    if (!this.s3Client) return;
    const command = new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey });
    await this.s3Client.send(command);
  }
}
