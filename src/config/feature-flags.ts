export class FeatureFlags {
  static get enableUploads(): boolean {
    return process.env.ENABLE_UPLOADS !== "false";
  }

  static get enableRss(): boolean {
    return process.env.ENABLE_RSS !== "false";
  }

  static get enableTranscription(): boolean {
    return process.env.ENABLE_TRANSCRIPTION !== "false";
  }

  static checkUploadsEnabled(): void {
    if (!this.enableUploads) {
      throw new Error("FEATURE_DISABLED_UPLOADS: L'upload natif de médias est temporairement désactivé par l'administration.");
    }
  }

  static checkRssEnabled(): void {
    if (!this.enableRss) {
      throw new Error("FEATURE_DISABLED_RSS: La synchronisation et l'importation RSS sont temporairement désactivées.");
    }
  }

  static checkTranscriptionEnabled(): void {
    if (!this.enableTranscription) {
      throw new Error("FEATURE_DISABLED_TRANSCRIPTION: La transcription automatique est temporairement désactivée.");
    }
  }
}
