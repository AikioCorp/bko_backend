import { prisma } from "../../config/prisma.js";
import { StorageFactory } from "../../services/storage/storage.factory.js";
import { SsrfProtectionService } from "../../services/ssrf-protection.service.js";
import { AuditService } from "../../services/audit.service.js";
import { EpisodeType } from "@prisma/client";

/**
 * Parcours admin de création / édition d'un épisode.
 *
 * Un épisode peut posséder deux sources indépendantes :
 *  - une version audio (fichier envoyé vers le stockage, ou adresse audio directe / RSS) ;
 *  - une vidéo YouTube (référence + métadonnées ; jamais téléchargée par le serveur).
 * Remplacer l'une ne touche jamais l'autre.
 */

const MAX_AUDIO_BYTES = 250 * 1024 * 1024;
const ALLOWED_AUDIO_MIMES = ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/ogg"];
const EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
};
const BLOCKED_AUDIO_HOSTS = ["youtube.com", "youtu.be", "spotify.com", "deezer.com", "soundcloud.com", "apple.com", "vimeo.com"];
const EPISODE_TYPES: EpisodeType[] = ["FULL", "TRAILER", "BONUS"];

export class AdminEpisodeError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

const findEpisode = async (idOrSlug: string) => {
  const ep = await prisma.episode.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: { podcast: { select: { id: true, status: true, primaryLanguageCode: true } } },
  });
  if (!ep) throw new AdminEpisodeError("EPISODE_NOT_FOUND", "Épisode introuvable", 404);
  return ep;
};

const slugifyTitle = (title: string) =>
  (title || "episode")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "episode";

const uniqueSlug = async (podcastId: string, title: string, excludeId?: string) => {
  const base = slugifyTitle(title);
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const clash = await prisma.episode.findFirst({ where: { slug, podcastId, ...(excludeId ? { NOT: { id: excludeId } } : {}) }, select: { id: true } });
    if (!clash) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
};

const extractYoutubeId = (raw: string): string | null => {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/);
      if (m) id = m[2];
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
};

/** Résume l'état des sources d'un épisode pour le front. */
const describeSources = async (episodeId: string) => {
  const [sources, pendingUpload] = await Promise.all([
    prisma.mediaSource.findMany({ where: { episodeId }, include: { mediaAsset: true }, orderBy: { createdAt: "desc" } }),
    prisma.uploadSession.findFirst({
      where: { episodeId, mediaType: "AUDIO", status: { in: ["UPLOADING", "COMPLETED", "FAILED"] } },
      include: { mediaAsset: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const audioSrc = sources.find((s) => s.type === "AUDIO" && s.isPrimaryAudio) || sources.find((s) => s.type === "AUDIO");
  const ytSrc = sources.find((s) => s.type === "VIDEO" && s.provider === "YOUTUBE");

  // État audio : envoi → traitement → prêt / erreur
  let audioState: "NONE" | "UPLOADING" | "PROCESSING" | "READY" | "ERROR" = audioSrc ? "READY" : "NONE";
  let audioError: string | null = null;
  // Un envoi plus récent que la source actuelle prend le pas (remplacement en cours).
  if (pendingUpload && (!audioSrc || pendingUpload.createdAt > audioSrc.createdAt)) {
    const assetStatus = pendingUpload.mediaAsset?.status;
    if (pendingUpload.status === "UPLOADING") audioState = "UPLOADING";
    else if (pendingUpload.status === "FAILED" || assetStatus === "FAILED") {
      audioState = audioSrc ? "READY" : "ERROR";
      audioError = "Le traitement du dernier fichier a échoué. Renvoyez-le.";
    } else if (assetStatus === "PROCESSING" || assetStatus === "UPLOADING") audioState = "PROCESSING";
  }

  return {
    audio: audioSrc
      ? {
          id: audioSrc.id,
          origin: audioSrc.sourceType, // UPLOAD | EXTERNAL | RSS_FEED
          url: audioSrc.externalUrl,
          filename: pendingUpload?.mediaAssetId === audioSrc.mediaAssetId ? pendingUpload?.originalFilename : null,
          durationSeconds: audioSrc.durationSeconds ?? audioSrc.mediaAsset?.durationSeconds ?? null,
          mimeType: audioSrc.mimeType,
          status: audioSrc.status,
          lastError: audioSrc.lastError,
        }
      : null,
    audioState,
    audioError,
    pendingUpload: pendingUpload
      ? { id: pendingUpload.id, filename: pendingUpload.originalFilename, status: pendingUpload.status, assetStatus: pendingUpload.mediaAsset?.status ?? null }
      : null,
    youtube: ytSrc
      ? {
          id: ytSrc.id,
          videoId: ytSrc.externalId,
          url: ytSrc.externalUrl,
          embedUrl: ytSrc.embedUrl,
          durationSeconds: ytSrc.durationSeconds,
          title: (ytSrc as any).quality ? null : null,
          status: ytSrc.status,
          lastError: ytSrc.lastError,
        }
      : null,
  };
};

export class AdminEpisodeService {
  /** Récupère l'épisode, son podcast et l'état de ses sources. */
  static async get(idOrSlug: string) {
    const ep = await prisma.episode.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: {
        podcast: {
          select: {
            id: true,
            name: true,
            slug: true,
            cover: true,
            status: true,
            primaryLanguageCode: true,
            categories: { include: { category: true } },
            rssFeed: { select: { id: true, url: true, lastFetchedAt: true, status: true } as any },
          },
        },
        season: true,
        language: true,
        mediaSources: true,
        transcripts: true,
        chapters: { orderBy: { startTimeMs: "asc" } },
        rssImportedEpisodes: { take: 1, orderBy: { createdAt: "desc" } as any },
      },
    });
    if (!ep) return null;
    const sources = await describeSources(ep.id);
    const scheduledJob =
      ep.status === "SCHEDULED"
        ? await prisma.jobQueueItem.findFirst({
            where: { queueName: "episodes-publisher", status: "PENDING", payload: { path: ["episodeId"], equals: ep.id } },
            select: { runAt: true },
          })
        : null;
    return { ...ep, sources, scheduledAt: scheduledJob?.runAt ?? (ep.status === "SCHEDULED" ? ep.publishedAt : null) };
  }

  /** Crée un brouillon rattaché au podcast (langue héritée du podcast). */
  static async createDraft(adminId: string, podcastIdOrSlug: string, data: any) {
    const podcast = await prisma.podcast.findFirst({ where: { OR: [{ id: podcastIdOrSlug }, { slug: podcastIdOrSlug }] } });
    if (!podcast) throw new AdminEpisodeError("PODCAST_NOT_FOUND", "Podcast introuvable", 404);

    const title = String(data.title || "").trim() || "Nouvel épisode";
    const slug = await uniqueSlug(podcast.id, title);

    const episode = await prisma.episode.create({
      data: {
        podcastId: podcast.id,
        title,
        slug,
        description: data.description || "",
        summary: data.summary || null,
        cover: data.cover || null,
        languageCode: data.languageCode || podcast.primaryLanguageCode,
        episodeType: EPISODE_TYPES.includes(data.episodeType) ? data.episodeType : "FULL",
        explicit: Boolean(data.explicit),
        episodeNumber: data.episodeNumber ? Number(data.episodeNumber) : null,
        status: "DRAFT",
        publishedAt: null,
        creationSource: "ADMIN",
      },
    });

    await AuditService.logAction({ actorId: adminId, action: "EPISODE_DRAFT_CREATED", entityType: "EPISODE", entityId: episode.id }).catch(() => {});
    return episode;
  }

  /** Modifie les informations (les sources ont leurs propres routes). */
  static async update(adminId: string, idOrSlug: string, data: any) {
    const ep = await findEpisode(idOrSlug);
    const u: any = {};
    if (data.title !== undefined) u.title = String(data.title);
    if (data.summary !== undefined) u.summary = data.summary || null;
    if (data.description !== undefined) u.description = data.description || "";
    if (data.cover !== undefined) u.cover = data.cover || null;
    if (data.languageCode !== undefined) u.languageCode = data.languageCode || null;
    if (data.episodeNumber !== undefined) u.episodeNumber = data.episodeNumber === "" || data.episodeNumber === null ? null : Number(data.episodeNumber);
    if (data.episodeType !== undefined && EPISODE_TYPES.includes(data.episodeType)) u.episodeType = data.episodeType;
    if (data.explicit !== undefined) u.explicit = Boolean(data.explicit);
    if (data.slug !== undefined && data.slug) u.slug = await uniqueSlug(ep.podcastId, data.slug, ep.id);

    // Saison : numéro saisi → saison existante ou créée à la volée.
    if (data.seasonNumber !== undefined) {
      const n = data.seasonNumber === "" || data.seasonNumber === null ? null : Number(data.seasonNumber);
      if (!n) u.seasonId = null;
      else {
        const season = await prisma.season.upsert({
          where: { podcastId_number: { podcastId: ep.podcastId, number: n } },
          create: { podcastId: ep.podcastId, number: n },
          update: {},
        });
        u.seasonId = season.id;
      }
    }

    // Épisode importé par RSS : on marque la modification manuelle si demandé (conservée lors des synchros).
    if (data.keepManualEdits !== undefined) u.isManuallyEdited = Boolean(data.keepManualEdits);
    else if (ep.creationSource === "RSS_IMPORT" && Object.keys(u).length) u.isManuallyEdited = true;

    // Changement de statut direct limité au retour en brouillon (la publication passe par /publish).
    if (data.status === "DRAFT" && ep.status !== "DRAFT") {
      u.status = "DRAFT";
      await prisma.jobQueueItem.updateMany({
        where: { queueName: "episodes-publisher", status: "PENDING", payload: { path: ["episodeId"], equals: ep.id } },
        data: { status: "CANCELED" as any },
      }).catch(() => {});
    }

    await prisma.episode.update({ where: { id: ep.id }, data: u });
    return this.get(ep.id);
  }

  // ---------------------------------------------------------------- AUDIO

  /** Prépare un envoi direct vers le stockage (URL présignée temporaire). */
  static async createAudioUpload(adminId: string, idOrSlug: string, body: { filename: string; mimeType: string; sizeBytes: number }) {
    const ep = await findEpisode(idOrSlug);
    const mimeType = String(body.mimeType || "").toLowerCase();
    const sizeBytes = Number(body.sizeBytes || 0);
    if (!ALLOWED_AUDIO_MIMES.includes(mimeType)) throw new AdminEpisodeError("INVALID_MEDIA_TYPE", "Format non pris en charge (MP3, M4A, AAC, WAV ou OGG).");
    if (!sizeBytes || sizeBytes > MAX_AUDIO_BYTES) throw new AdminEpisodeError("FILE_TOO_LARGE", "Le fichier dépasse 250 Mo.");

    const d = new Date();
    const key = `media/episodes/${ep.id}/${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}/audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${EXT_BY_MIME[mimeType] ?? "mp3"}`;

    const storage = StorageFactory.getProvider();
    const presigned = await storage.createPresignedUploadUrl(key, mimeType, 3600);

    const session = await prisma.uploadSession.create({
      data: {
        userId: adminId,
        episodeId: ep.id,
        mediaType: "AUDIO",
        originalFilename: String(body.filename || "audio").slice(0, 200),
        mimeType,
        sizeBytes: BigInt(sizeBytes),
        storageKey: key,
        status: "UPLOADING",
        expiresAt: presigned.expiresAt,
      },
    });

    return { uploadId: session.id, uploadUrl: presigned.uploadUrl, expiresAt: presigned.expiresAt, mimeType };
  }

  /** Confirme l'envoi : vérifie l'objet, crée l'asset et lance le traitement (durée, métadonnées). */
  static async completeAudioUpload(adminId: string, idOrSlug: string, uploadId: string) {
    const ep = await findEpisode(idOrSlug);
    const session = await prisma.uploadSession.findUnique({ where: { id: uploadId } });
    if (!session || session.episodeId !== ep.id) throw new AdminEpisodeError("SESSION_NOT_FOUND", "Envoi introuvable", 404);
    if (session.status === "COMPLETED" && session.mediaAssetId) return this.get(ep.id); // idempotent
    if (session.status !== "UPLOADING") throw new AdminEpisodeError("SESSION_NOT_FOUND", "Cet envoi n'est plus valide. Recommencez.", 409);

    const storage = StorageFactory.getProvider();
    if (!(await storage.objectExists(session.storageKey))) {
      await prisma.uploadSession.update({ where: { id: session.id }, data: { status: "FAILED" } });
      throw new AdminEpisodeError("OBJECT_NOT_FOUND", "Le fichier n'a pas été reçu par le stockage. Réessayez l'envoi.", 409);
    }
    const meta = await storage.getMetadata(session.storageKey);

    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: adminId,
        uploaderId: adminId,
        storageProvider: "R2",
        bucket: process.env.R2_BUCKET_MEDIA || "bamako-podcast-media",
        key: session.storageKey,
        mimeType: session.mimeType,
        sizeBytes: meta?.sizeBytes ?? session.sizeBytes,
        status: "PROCESSING",
      },
    });
    await prisma.uploadSession.update({ where: { id: session.id }, data: { status: "COMPLETED", completedAt: new Date(), mediaAssetId: asset.id } });
    await prisma.jobQueueItem.create({
      data: {
        queueName: "media-processing",
        jobType: "MEDIA_ANALYZE",
        // replaceAudio : l'ancienne version audio n'est retirée qu'une fois la nouvelle prête.
        payload: { mediaAssetId: asset.id, episodeId: ep.id, mediaType: "AUDIO", replaceAudio: true },
      },
    });
    return this.get(ep.id);
  }

  /** Adresse audio directe : doit pointer vers une ressource audio lisible (pas une page). */
  static async setAudioUrl(adminId: string, idOrSlug: string, rawUrl: string) {
    const ep = await findEpisode(idOrSlug);
    let url: URL;
    try {
      url = new URL(String(rawUrl || "").trim());
    } catch {
      throw new AdminEpisodeError("INVALID_URL", "Adresse invalide.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new AdminEpisodeError("INVALID_URL", "L'adresse doit commencer par https://");
    const host = url.hostname.replace(/^www\./, "");
    if (BLOCKED_AUDIO_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
      throw new AdminEpisodeError("NOT_AUDIO", "Cette adresse est une page de plateforme, pas un fichier audio. Utilisez le bloc YouTube pour une vidéo, ou une adresse de fichier (.mp3, .m4a…).");
    }

    // Vérification serveur (protégée SSRF) : en-têtes de la ressource, sans télécharger le fichier entier.
    let mimeType = "";
    let finalUrl = url.href;
    try {
      let current = url.href;
      for (let hop = 0; hop < 5; hop++) {
        const safe = await SsrfProtectionService.validateUrl(current);
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10000);
        let res = await fetch(safe, { method: "HEAD", redirect: "manual", signal: ctrl.signal }).catch(() => null);
        if (!res || res.status === 405 || res.status === 403) {
          res = await fetch(safe, { method: "GET", headers: { Range: "bytes=0-1023" }, redirect: "manual", signal: ctrl.signal });
          res.body?.cancel().catch(() => {});
        }
        clearTimeout(t);
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const loc = res.headers.get("location");
          if (!loc) throw new Error("redirect");
          current = new URL(loc, safe).href;
          continue;
        }
        if (!res.ok && res.status !== 206) throw new AdminEpisodeError("AUDIO_UNREACHABLE", `La ressource ne répond pas (HTTP ${res.status}).`);
        mimeType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        finalUrl = safe;
        break;
      }
    } catch (e: any) {
      if (e instanceof AdminEpisodeError) throw e;
      throw new AdminEpisodeError("AUDIO_UNREACHABLE", "Impossible de joindre cette adresse depuis le serveur.");
    }
    const looksAudioByExt = /\.(mp3|m4a|aac|wav|ogg|oga|opus)(\?|$)/i.test(finalUrl);
    const isAudio = mimeType.startsWith("audio/") || (mimeType === "application/octet-stream" && looksAudioByExt) || (!mimeType && looksAudioByExt);
    if (!isAudio) {
      throw new AdminEpisodeError("NOT_AUDIO", `Cette adresse ne renvoie pas un fichier audio (type reçu : ${mimeType || "inconnu"}).`);
    }

    await prisma.$transaction([
      prisma.mediaSource.deleteMany({ where: { episodeId: ep.id, type: "AUDIO" } }),
      prisma.mediaSource.create({
        data: {
          episodeId: ep.id,
          type: "AUDIO",
          sourceType: "EXTERNAL",
          playbackMode: "NATIVE",
          externalUrl: url.href,
          mimeType: mimeType || null,
          isPrimaryAudio: true,
          status: "ACTIVE",
          lastCheckedAt: new Date(),
        },
      }),
    ]);
    return this.get(ep.id);
  }

  static async removeAudio(adminId: string, idOrSlug: string) {
    const ep = await findEpisode(idOrSlug);
    await prisma.mediaSource.deleteMany({ where: { episodeId: ep.id, type: "AUDIO" } });
    // Un envoi en cours n'aboutira pas à une source (asset orphelin marqué supprimé).
    await prisma.uploadSession.updateMany({ where: { episodeId: ep.id, mediaType: "AUDIO", status: "UPLOADING" }, data: { status: "CANCELED" } });
    return this.get(ep.id);
  }

  // -------------------------------------------------------------- YOUTUBE

  /** Identifie la vidéo et récupère les informations disponibles (oEmbed public). */
  static async previewYoutube(rawUrl: string) {
    const videoId = extractYoutubeId(String(rawUrl || ""));
    if (!videoId) throw new AdminEpisodeError("INVALID_YOUTUBE_URL", "Ce lien n'est pas une adresse de vidéo YouTube reconnue.");
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`, { signal: ctrl.signal });
      if (res.status === 401 || res.status === 403) {
        return { videoId, watchUrl, embeddable: false, reason: "Le propriétaire de la vidéo n'autorise pas sa lecture sur d'autres sites.", title: null, channel: null, thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
      }
      if (res.status === 404 || res.status === 400) {
        return { videoId, watchUrl, embeddable: false, reason: "Vidéo introuvable, privée ou supprimée.", title: null, channel: null, thumbnail: null };
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j: any = await res.json();
      return {
        videoId,
        watchUrl,
        embeddable: true, // présomption : confirmée seulement par l'essai dans le lecteur officiel
        reason: null,
        title: j.title ?? null,
        channel: j.author_name ?? null,
        thumbnail: j.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      };
    } catch {
      return { videoId, watchUrl, embeddable: null, reason: "Impossible de contacter YouTube pour vérifier la vidéo. Testez la prévisualisation.", title: null, channel: null, thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
    } finally {
      clearTimeout(t);
    }
  }

  static async setYoutube(adminId: string, idOrSlug: string, body: { url: string; durationSeconds?: number }) {
    const ep = await findEpisode(idOrSlug);
    const preview = await this.previewYoutube(body.url);
    if (preview.embeddable === false && preview.title === null && !preview.thumbnail) {
      throw new AdminEpisodeError("YOUTUBE_UNAVAILABLE", preview.reason || "Vidéo indisponible.");
    }
    await prisma.$transaction([
      prisma.mediaSource.deleteMany({ where: { episodeId: ep.id, type: "VIDEO", provider: "YOUTUBE" } }),
      prisma.mediaSource.create({
        data: {
          episodeId: ep.id,
          type: "VIDEO",
          sourceType: "EXTERNAL",
          provider: "YOUTUBE",
          playbackMode: "EMBED",
          externalId: preview.videoId,
          externalUrl: preview.watchUrl,
          embedUrl: `https://www.youtube-nocookie.com/embed/${preview.videoId}`,
          durationSeconds: body.durationSeconds ? Math.round(Number(body.durationSeconds)) : null,
          isPrimaryVideo: true,
          status: preview.embeddable === false ? "EMBED_BLOCKED" : "ACTIVE",
          lastError: preview.reason,
          lastCheckedAt: new Date(),
        },
      }),
    ]);
    // Pochette : si l'épisode n'en a pas, on ne force rien (la pochette du podcast reste la référence).
    return this.get(ep.id);
  }

  /** Le front signale le résultat de l'essai dans le lecteur officiel (succès, ou code d'erreur). */
  static async reportYoutubeCheck(idOrSlug: string, body: { ok: boolean; errorCode?: number; durationSeconds?: number }) {
    const ep = await findEpisode(idOrSlug);
    const reasons: Record<number, string> = {
      2: "Identifiant de vidéo invalide.",
      5: "La vidéo ne peut pas être lue dans le lecteur HTML5.",
      100: "Vidéo introuvable, privée ou supprimée.",
      101: "Le propriétaire n'autorise pas la lecture sur d'autres sites.",
      150: "Le propriétaire n'autorise pas la lecture sur d'autres sites.",
      153: "Lecture refusée par YouTube (configuration du lecteur).",
    };
    await prisma.mediaSource.updateMany({
      where: { episodeId: ep.id, type: "VIDEO", provider: "YOUTUBE" },
      data: {
        status: body.ok ? "ACTIVE" : "EMBED_BLOCKED",
        lastError: body.ok ? null : reasons[body.errorCode ?? -1] || `Lecture impossible (code ${body.errorCode ?? "inconnu"}).`,
        lastCheckedAt: new Date(),
        ...(body.ok && body.durationSeconds ? { durationSeconds: Math.round(body.durationSeconds) } : {}),
      },
    });
    return this.get(ep.id);
  }

  static async removeYoutube(adminId: string, idOrSlug: string) {
    const ep = await findEpisode(idOrSlug);
    await prisma.mediaSource.deleteMany({ where: { episodeId: ep.id, type: "VIDEO", provider: "YOUTUBE" } });
    return this.get(ep.id);
  }

  // ---------------------------------------------------------- PUBLICATION

  static async checklist(idOrSlug: string) {
    const full = await this.get(idOrSlug);
    if (!full) throw new AdminEpisodeError("EPISODE_NOT_FOUND", "Épisode introuvable", 404);
    const s = full.sources;
    const audioBusy = s.audioState === "UPLOADING" || s.audioState === "PROCESSING";
    const hasPlayable = Boolean(s.audio) || Boolean(s.youtube && s.youtube.status !== "EMBED_BLOCKED");
    const podcastOpen = !["SUSPENDED", "ARCHIVED"].includes(full.podcast.status);
    const items = [
      { key: "title", label: "Titre renseigné", ok: Boolean(full.title?.trim()) && full.title !== "Nouvel épisode" },
      { key: "podcast", label: "Podcast sélectionné", ok: Boolean(full.podcastId) },
      { key: "language", label: "Langue renseignée", ok: Boolean(full.languageCode) },
      { key: "source", label: "Une source de lecture disponible", ok: hasPlayable },
      { key: "processing", label: "Traitement audio terminé", ok: !audioBusy },
      { key: "podcastStatus", label: "Podcast actif (ni suspendu ni archivé)", ok: podcastOpen },
    ];
    return { full, items, ready: items.every((i) => i.ok) };
  }

  /** Publie maintenant ou programme (date ISO avec fuseau). */
  static async publish(adminId: string, idOrSlug: string, body: { mode: "now" | "schedule"; publishAt?: string }) {
    const { full, items, ready } = await this.checklist(idOrSlug);
    if (!ready) {
      const missing = items.filter((i) => !i.ok).map((i) => i.label);
      throw new AdminEpisodeError("NOT_READY", `Publication impossible : ${missing.join(", ")}.`, 422);
    }

    // Annule une éventuelle programmation précédente.
    await prisma.jobQueueItem.updateMany({
      where: { queueName: "episodes-publisher", status: "PENDING", payload: { path: ["episodeId"], equals: full.id } },
      data: { status: "CANCELED" as any },
    }).catch(() => {});

    if (body.mode === "schedule") {
      const at = new Date(String(body.publishAt || ""));
      if (isNaN(at.getTime()) || at.getTime() <= Date.now() + 60_000) {
        throw new AdminEpisodeError("INVALID_DATE", "Choisissez une date future (au moins une minute après maintenant).");
      }
      await prisma.episode.update({ where: { id: full.id }, data: { status: "SCHEDULED", publishedAt: at } });
      await prisma.jobQueueItem.create({ data: { queueName: "episodes-publisher", jobType: "PUBLISH_EPISODE", payload: { episodeId: full.id }, runAt: at } });
    } else {
      await prisma.episode.update({ where: { id: full.id }, data: { status: "PUBLISHED", publishedAt: full.publishedAt && full.status === "PUBLISHED" ? full.publishedAt : new Date() } });
    }
    await AuditService.logAction({ actorId: adminId, action: body.mode === "schedule" ? "EPISODE_SCHEDULED" : "EPISODE_PUBLISHED", entityType: "EPISODE", entityId: full.id }).catch(() => {});
    return this.get(full.id);
  }
}
