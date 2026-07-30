import { StorageProvider, PresignedUploadResult, ObjectMetadata } from "./storage.interface.js";

export class LocalMockStorageProvider implements StorageProvider {
  private mockObjects = new Map<string, ObjectMetadata>();

  async createPresignedUploadUrl(
    storageKey: string,
    contentType: string,
    expiresInSeconds = 3600
  ): Promise<PresignedUploadResult> {
    const uploadUrl = `http://localhost:8080/api/v1/mock-storage/upload?key=${encodeURIComponent(storageKey)}`;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    // Enregistrer comme objet pré-existant pour le dev/test
    this.mockObjects.set(storageKey, {
      sizeBytes: BigInt(1024 * 1024 * 10), // 10 Mo simulés
      contentType,
      lastModified: new Date(),
    });

    return {
      uploadUrl,
      storageKey,
      expiresAt,
    };
  }

  async createPresignedDownloadUrl(storageKey: string): Promise<string> {
    const baseUrl = process.env.R2_PUBLIC_BASE_URL || "http://localhost:8080/media";
    return `${baseUrl}/${storageKey}`;
  }

  async objectExists(storageKey: string): Promise<boolean> {
    return true; // En mode local/mock, toujours valide
  }

  async getMetadata(storageKey: string): Promise<ObjectMetadata | null> {
    return (
      this.mockObjects.get(storageKey) || {
        sizeBytes: BigInt(1024 * 1024 * 5),
        contentType: "audio/mpeg",
        lastModified: new Date(),
      }
    );
  }

  async deleteObject(storageKey: string): Promise<void> {
    this.mockObjects.delete(storageKey);
  }
}
