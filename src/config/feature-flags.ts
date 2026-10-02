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

  // Exige qu'un compte soit vérifié (OTP) avant de pouvoir se connecter.
  // Désactivé par défaut : le flux client (web) n'implémente pas encore l'étape de
  // vérification OTP. À activer (REQUIRE_VERIFIED_LOGIN=true) une fois cette étape en place.
  static get requireVerifiedLogin(): boolean {
    return process.env.REQUIRE_VERIFIED_LOGIN === "true";
  }

  // Si activé, les contenus soumis par les créateurs passent par la file de validation
  // de l'administration (statut PENDING_REVIEW) au lieu d'être publiés directement.
  static get requireContentReview(): boolean {
    return process.env.REQUIRE_CONTENT_REVIEW === "true";
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
