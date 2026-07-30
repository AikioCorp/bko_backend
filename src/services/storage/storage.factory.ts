import { StorageProvider } from "./storage.interface.js";
import { CloudflareR2StorageProvider } from "./r2-storage.provider.js";
import { LocalMockStorageProvider } from "./local-mock-storage.provider.js";

export class StorageFactory {
  private static instance: StorageProvider;

  static getProvider(): StorageProvider {
    if (!this.instance) {
      const hasR2Creds =
        process.env.R2_ENDPOINT &&
        process.env.R2_ACCESS_KEY_ID &&
        process.env.R2_SECRET_ACCESS_KEY;

      if (hasR2Creds) {
        this.instance = new CloudflareR2StorageProvider();
      } else {
        this.instance = new LocalMockStorageProvider();
      }
    }
    return this.instance;
  }
}
