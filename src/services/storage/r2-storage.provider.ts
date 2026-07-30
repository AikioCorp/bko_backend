import { StorageProvider, PresignedUploadResult, ObjectMetadata } from "./storage.interface.js";

export class CloudflareR2StorageProvider implements StorageProvider {
  private endpoint: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private bucket: string;
  private publicBaseUrl: string;

  constructor() {
    this.endpoint = process.env.R2_ENDPOINT || "";
    this.accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
    this.secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || "";
    this.bucket = process.env.R2_BUCKET_MEDIA || "bamako-podcast-media";
    this.publicBaseUrl = process.env.R2_PUBLIC_BASE_URL || "https://media.bamakopodcast.com";
  }

  async createPresignedUploadUrl(
    storageKey: string,
    contentType: string,
    expiresInSeconds = 3600
  ): Promise<PresignedUploadResult> {
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    // Simulation d'URL signée S3 PUT pour R2
    const uploadUrl = `${this.endpoint}/${this.bucket}/${storageKey}?X-Amz-Expires=${expiresInSeconds}`;

    return {
      uploadUrl,
      storageKey,
      expiresAt,
    };
  }

  async createPresignedDownloadUrl(storageKey: string): Promise<string> {
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl}/${storageKey}`;
    }
    return `${this.endpoint}/${this.bucket}/${storageKey}`;
  }

  async objectExists(storageKey: string): Promise<boolean> {
    return true;
  }

  async getMetadata(storageKey: string): Promise<ObjectMetadata | null> {
    return {
      sizeBytes: BigInt(1024 * 1024 * 8),
      contentType: "audio/mpeg",
      lastModified: new Date(),
    };
  }

  async deleteObject(storageKey: string): Promise<void> {}
}
