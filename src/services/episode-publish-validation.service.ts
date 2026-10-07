import { prisma } from "../config/prisma.js";
import { MarketService } from "../modules/markets/market.service.js";

export interface ValidationIssue {
  key: string;
  label: string;
  ok: boolean;
  message?: string;
}

export interface ValidationResult {
  ready: boolean;
  issues: ValidationIssue[];
  episode: any;
}

export class EpisodePublishValidationService {
  /**
   * Vérifie exhaustivement la checklist de publication pour un épisode donné.
   * Utilisé de manière uniforme par :
   * - La publication immédiate créateur
   * - La programmation créateur
   * - La publication admin
   * - Le worker d'arrière-plan à l'échéance programmée
   */
  static async validate(
    episodeId: string,
    options: {
      userId?: string;
      checkMarket?: boolean;
    } = {}
  ): Promise<ValidationResult> {
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      include: {
        podcast: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            countryId: true,
            primaryLanguageCode: true,
          },
        },
        mediaSources: {
          include: { mediaAsset: true },
        },
      },
    });

    if (!episode) {
      throw new Error("EPISODE_NOT_FOUND");
    }

    const issues: ValidationIssue[] = [];

    // 1. Titre
    const titleOk = Boolean(episode.title?.trim()) && episode.title.trim() !== "Nouvel épisode";
    issues.push({
      key: "title",
      label: "Titre renseigné",
      ok: titleOk,
      message: titleOk ? undefined : "L'épisode doit avoir un titre valide différent du titre par défaut.",
    });

    // 2. Description
    const descOk = Boolean(episode.description?.trim());
    issues.push({
      key: "description",
      label: "Description renseignée",
      ok: descOk,
      message: descOk ? undefined : "La description de l'épisode est obligatoire.",
    });

    // 3. Podcast et statut actif
    const podcastActive = !["SUSPENDED", "ARCHIVED"].includes(episode.podcast?.status || "");
    issues.push({
      key: "podcast_status",
      label: "Podcast actif",
      ok: podcastActive,
      message: podcastActive ? undefined : `Le podcast est suspendu ou archivé (statut : ${episode.podcast?.status}).`,
    });

    // 4. Langue
    const langOk = Boolean(episode.languageCode || episode.podcast?.primaryLanguageCode);
    issues.push({
      key: "language",
      label: "Langue renseignée",
      ok: langOk,
      message: langOk ? undefined : "Une langue doit être définie pour l'épisode ou le podcast.",
    });

    // 5. Sources média jouables et prêtes
    const playableAudio = episode.mediaSources.find(
      (s) => s.type === "AUDIO" && (!s.mediaAsset || s.mediaAsset.status === "READY") && (s.externalUrl || s.mediaAssetId)
    );
    const audioProcessing = episode.mediaSources.some(
      (s) => s.type === "AUDIO" && s.mediaAsset && (s.mediaAsset.status === "PROCESSING" || s.mediaAsset.status === "UPLOADING")
    );
    const playableVideo = episode.mediaSources.find(
      (s) => s.type === "VIDEO" && s.status !== "EMBED_BLOCKED" && (s.externalUrl || s.externalId)
    );

    const hasPlayableSource = Boolean(playableAudio || playableVideo);
    issues.push({
      key: "media_source",
      label: "Au moins une source média disponible",
      ok: hasPlayableSource,
      message: hasPlayableSource ? undefined : "Aucune source audio prête ou vidéo diffusable n'est associée.",
    });

    issues.push({
      key: "media_processing",
      label: "Traitement audio terminé",
      ok: !audioProcessing,
      message: !audioProcessing ? undefined : "Le fichier audio est encore en cours d'optimisation.",
    });

    // 6. Droits de marché (optionnel, pour les créateurs)
    if (options.checkMarket && options.userId && episode.podcast?.countryId) {
      const creatorProfile = await prisma.creatorProfile.findUnique({
        where: { userId: options.userId },
      });
      const canPublish = await MarketService.checkCapability(
        episode.podcast.countryId,
        "publishingEnabled",
        creatorProfile?.id
      );
      issues.push({
        key: "market_capability",
        label: "Marché ouvert à la publication",
        ok: canPublish,
        message: canPublish ? undefined : "La publication n'est pas autorisée dans le pays de diffusion de ce podcast.",
      });
    }

    const ready = issues.every((i) => i.ok);
    return { ready, issues, episode };
  }

  /**
   * Valide et lève une exception descriptive si l'épisode n'est pas publiable.
   */
  static async assertCanPublish(
    episodeId: string,
    options: {
      userId?: string;
      checkMarket?: boolean;
    } = {}
  ): Promise<any> {
    const { ready, issues, episode } = await this.validate(episodeId, options);
    if (!ready) {
      const failing = issues.filter((i) => !i.ok);
      const messages = failing.map((i) => i.message || i.label).join(" ; ");
      const error = new Error(`Publication impossible : ${messages}`);
      (error as any).issues = failing;
      (error as any).code = "VALIDATION_FAILED";
      throw error;
    }
    return episode;
  }
}
