export interface PresignedUploadResult {
  uploadUrl: string;
  storageKey: string;
  expiresAt: Date;
}

export interface ObjectMetadata {
  sizeBytes: bigint;
  contentType: string;
  lastModified: Date;
}

export interface StorageProvider {
  createPresignedUploadUrl(
    storageKey: string,
    contentType: string,
    expiresInSeconds?: number
  ): Promise<PresignedUploadResult>;

  createPresignedDownloadUrl(
    storageKey: string,
    expiresInSeconds?: number
  ): Promise<string>;

  objectExists(storageKey: string): Promise<boolean>;

  getMetadata(storageKey: string): Promise<ObjectMetadata | null>;

  deleteObject(storageKey: string): Promise<void>;
}
