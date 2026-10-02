import { PodcastMemberRole, EpisodeStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { StorageFactory } from "../../services/storage/storage.factory.js";
import { SsrfProtectionService } from "../../services/ssrf-protection.service.js";
import { MediaResolverService } from "./media-resolver.service.js";

const WRITERS: PodcastMemberRole[] = ["OWNER", "ADMIN", "EDITOR"];
const MANAGERS: PodcastMemberRole[] = ["OWNER", "ADMIN"];
const ANY: PodcastMemberRole[] = ["OWNER", "ADMIN", "EDITOR", "ANALYST"];

async function assertMember(userId: string, podcastId: string, allowed: PodcastMemberRole[]) {
  const member = await prisma.podcastMember.findUnique({ where: { podcastId_userId: { podcastId, userId } } });
  if (!member || !allowed.includes(member.role)) throw new Error("FORBIDDEN");
  return member;
}

async function loadEpisode(episodeId: string) {
  const episode = await prisma.episode.findUnique({ where: { id: episodeId } });
  if (!episode) throw new Error("EPISODE_NOT_FOUND");
  return episode;
}

/** Annule les jobs de publication en attente pour un épisode. */
async function cancelPublishJobs(episodeId: string) {
  await prisma.jobQueueItem.updateMany({
    where: { queueName: "episodes-publisher", status: "PENDING", payload: { path: ["episodeId"], equals: episodeId } },
    data: { status: "CANCELLED" },
  });
}

export class CreatorManageService {
  // ───────────────────────── ÉPISODES ─────────────────────────

  /** Vue complète pour l'équipe (brouillons inclus) : alimente l'écran d'édition. */
  static async getEpisode(userId: string, episodeId: string) {
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      include: {
        podcast: { select: { id: true, name: true, slug: true, cover: true, status: true, countryId: true } },
        season: true,
        mediaSources: { include: { mediaAsset: { select: { id: true, status: true, sizeBytes: true, durationSeconds: true } } }, orderBy: { createdAt: "asc" } },
        people: { include: { person: true } },
        topics: { include: { topic: true } },
        _count: { select: { transcripts: true, chapters: true } },
      },
    });
    if (!episode) throw new Error("EPISODE_NOT_FOUND");
    await assertMember(userId, episode.podcastId, ANY);
    // BigInt non sérialisable en JSON
    return {
      ...episode,
      mediaSources: episode.mediaSources.map((m) => ({
        ...m,
        mediaAsset: m.mediaAsset ? { ...m.mediaAsset, sizeBytes: Number(m.mediaAsset.sizeBytes) } : null,
      })),
    };
  }

  static async updateEpisode(
    userId: string,
    episodeId: string,
    data: {
      title?: string;
      description?: string;
      cover?: string | null;
      seasonId?: string | null;
      episodeNumber?: number | null;
      languageCode?: string;
      topicIds?: string[];
      people?: Array<{ personId: string; role?: any }>;
    }
  ) {
    const episode = await loadEpisode(episodeId);
    await assertMember(userId, episode.podcastId, WRITERS);

    if (data.seasonId) {
      const season = await prisma.season.findUnique({ where: { id: data.seasonId } });
      if (!season || season.podcastId !== episode.podcastId) throw new Error("SEASON_NOT_FOUND");
    }

    const { topicIds, people, ...scalar } = data;
    return prisma.$transaction(async (tx) => {
      if (topicIds) {
        await tx.episodeTopic.deleteMany({ where: { episodeId } });
        await tx.episodeTopic.createMany({ data: topicIds.map((topicId) => ({ episodeId, topicId })), skipDuplicates: true });
      }
      if (people) {
        await tx.episodePerson.deleteMany({ where: { episodeId } });
        await tx.episodePerson.createMany({
          data: people.map((p) => ({ episodeId, personId: p.personId, role: p.role || "GUEST" })),
          skipDuplicates: true,
        });
      }
      // Le slug reste stable : renommer un épisode ne casse pas les liens déjà partagés.
      return tx.episode.update({ where: { id: episodeId }, data: { ...scalar, isManuallyEdited: true } });
    });
  }

  /** Dépublie : l'épisode redevient un brouillon (et toute programmation est annulée). */
  static async unpublishEpisode(userId: string, episodeId: string) {
    const episode = await loadEpisode(episodeId);
    await assertMember(userId, episode.podcastId, WRITERS);
    const allowed: EpisodeStatus[] = ["PUBLISHED", "SCHEDULED", "PENDING_REVIEW", "UNLISTED"];
    if (!allowed.includes(episode.status)) throw new Error("INVALID_STATE");
    await cancelPublishJobs(episodeId);
    return prisma.episode.update({ where: { id: episodeId }, data: { status: "DRAFT" } });
  }

  /** Annule une programmation sans perdre l'épisode. */
  static async unscheduleEpisode(userId: string, episodeId: string) {
    const episode = await loadEpisode(episodeId);
    await assertMember(userId, episode.podcastId, WRITERS);
    if (episode.status !== "SCHEDULED") throw new Error("INVALID_STATE");
    await cancelPublishJobs(episodeId);
    return prisma.episode.update({ where: { id: episodeId }, data: { status: "DRAFT", publishedAt: null } });
  }

  static async archiveEpisode(userId: string, episodeId: string) {
    const episode = await loadEpisode(episodeId);
    await assertMember(userId, episode.podcastId, MANAGERS);
    await cancelPublishJobs(episodeId);
    return prisma.episode.update({ where: { id: episodeId }, data: { status: "ARCHIVED" } });
  }

  static async restoreEpisode(userId: string, episodeId: string) {
    const episode = await loadEpisode(episodeId);
    await assertMember(userId, episode.podcastId, MANAGERS);
    if (episode.status !== "ARCHIVED") throw new Error("INVALID_STATE");
    return prisma.episode.update({ where: { id: episodeId }, data: { status: "DRAFT" } });
  }

  // ───────────────────────── SOURCES MÉDIA ─────────────────────────

  static async removeMediaSource(userId: string, episodeId: string, sourceId: string) {
    const episode = await loadEpisode(episodeId);
    await assertMember(userId, episode.podcastId, WRITERS);
    const source = await prisma.mediaSource.findUnique({ where: { id: sourceId } });
    if (!source || source.episodeId !== episodeId) throw new Error("SOURCE_NOT_FOUND");

    // Un épisode en ligne doit toujours garder au moins une source lisible.
    if (["PUBLISHED", "SCHEDULED"].includes(episode.status)) {
      const count = await prisma.mediaSource.count({ where: { episodeId } });
      if (count <= 1) throw new Error("EPISODE_NEEDS_MEDIA");
    }

    await prisma.mediaSource.delete({ where: { id: sourceId } });

    // Fichier hébergé : on libère le quota et on supprime l'objet (si plus aucune source ne l'utilise).
    if (source.mediaAssetId) {
      const stillUsed = await prisma.mediaSource.count({ where: { mediaAssetId: source.mediaAssetId } });
      if (!stillUsed) {
        const asset = await prisma.mediaAsset.update({ where: { id: source.mediaAssetId }, data: { status: "DELETED" } });
        await StorageFactory.getProvider().deleteObject(asset.key).catch(() => {});
      }
    }
    return { id: sourceId };
  }

  static async setPrimarySource(userId: string, episodeId: string, sourceId: string) {
    const episode = await loadEpisode(episodeId);
    await assertMember(userId, episode.podcastId, WRITERS);
    const source = await prisma.mediaSource.findUnique({ where: { id: sourceId } });
    if (!source || source.episodeId !== episodeId) throw new Error("SOURCE_NOT_FOUND");

    const field = source.type === "AUDIO" ? "isPrimaryAudio" : "isPrimaryVideo";
    await prisma.$transaction([
      prisma.mediaSource.updateMany({ where: { episodeId, type: source.type }, data: { [field]: false } }),
      prisma.mediaSource.update({ where: { id: sourceId }, data: { [field]: true } }),
    ]);
    return { id: sourceId };
  }

  /**
   * Prévisualise un lien collé par le créateur : fournisseur détecté + titre/vignette
   * (oEmbed) pour pré-remplir le formulaire. Les échecs oEmbed ne sont jamais bloquants.
   */
  static async previewLink(rawUrl: string, mediaTypePreference?: "AUDIO" | "VIDEO") {
    const resolved = MediaResolverService.resolveUrl(rawUrl, mediaTypePreference);
    const oembedUrl: Record<string, string> = {
      YOUTUBE: `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(resolved.externalUrl)}`,
      VIMEO: `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(resolved.externalUrl)}`,
      SPOTIFY: `https://open.spotify.com/oembed?url=${encodeURIComponent(resolved.externalUrl)}`,
      SOUNDCLOUD: `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(resolved.externalUrl)}`,
    };
    let meta: { title?: string; author?: string; thumbnail?: string } = {};
    const endpoint = oembedUrl[resolved.provider];
    if (endpoint) {
      try {
        const res = await SsrfProtectionService.safeFetch(endpoint, { Accept: "application/json" });
        const j = JSON.parse(res.text);
        meta = { title: j.title, author: j.author_name, thumbnail: j.thumbnail_url };
      } catch {
        /* le lien reste utilisable sans métadonnées */
      }
    }
    return { ...resolved, meta };
  }

  // ───────────────────────── SAISONS ─────────────────────────

  static async listSeasons(userId: string, podcastId: string) {
    await assertMember(userId, podcastId, ANY);
    return prisma.season.findMany({ where: { podcastId }, orderBy: { number: "asc" }, include: { _count: { select: { episodes: true } } } });
  }

  static async createSeason(userId: string, podcastId: string, data: { number?: number; title?: string; description?: string; cover?: string }) {
    await assertMember(userId, podcastId, WRITERS);
    let number = data.number;
    if (!number) {
      const last = await prisma.season.findFirst({ where: { podcastId }, orderBy: { number: "desc" } });
      number = (last?.number ?? 0) + 1;
    } else if (await prisma.season.findUnique({ where: { podcastId_number: { podcastId, number } } })) {
      throw new Error("SEASON_EXISTS");
    }
    return prisma.season.create({ data: { podcastId, number, title: data.title, description: data.description, cover: data.cover } });
  }

  static async updateSeason(userId: string, seasonId: string, data: { title?: string | null; description?: string | null; cover?: string | null }) {
    const season = await prisma.season.findUnique({ where: { id: seasonId } });
    if (!season) throw new Error("SEASON_NOT_FOUND");
    await assertMember(userId, season.podcastId, WRITERS);
    return prisma.season.update({ where: { id: seasonId }, data });
  }

  static async deleteSeason(userId: string, seasonId: string) {
    const season = await prisma.season.findUnique({ where: { id: seasonId } });
    if (!season) throw new Error("SEASON_NOT_FOUND");
    await assertMember(userId, season.podcastId, MANAGERS);
    // Les épisodes sont conservés (seasonId → null).
    await prisma.season.delete({ where: { id: seasonId } });
    return { id: seasonId };
  }

  // ───────────────────────── STATISTIQUES ─────────────────────────

  static async getAnalytics(userId: string, podcastId: string, days: number) {
    await assertMember(userId, podcastId, ANY);
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));

    const where: Prisma.EpisodeDailyStatsWhereInput = { date: { gte: since }, episode: { podcastId } };
    const [daily, perEpisode, followers, newFollowers, episodes] = await Promise.all([
      prisma.episodeDailyStats.groupBy({
        by: ["date"],
        where,
        _sum: { plays: true, qualifiedPlays: true, completedPlays: true, totalPlayTimeSeconds: true, uniqueListeners: true },
        orderBy: { date: "asc" },
      }),
      prisma.episodeDailyStats.groupBy({
        by: ["episodeId"],
        where,
        _sum: { plays: true, completedPlays: true },
        orderBy: { _sum: { plays: "desc" } },
        take: 5,
      }),
      prisma.podcastFollow.count({ where: { podcastId } }),
      prisma.podcastFollow.count({ where: { podcastId, createdAt: { gte: since } } }),
      prisma.episode.groupBy({ by: ["status"], where: { podcastId }, _count: { id: true } }),
    ]);

    const titles = await prisma.episode.findMany({
      where: { id: { in: perEpisode.map((e) => e.episodeId) } },
      select: { id: true, title: true },
    });
    const titleOf = new Map(titles.map((t) => [t.id, t.title]));
    const n = (v: number | bigint | null | undefined) => Number(v ?? 0);

    const series = daily.map((d) => ({
      date: d.date.toISOString().slice(0, 10),
      plays: n(d._sum.plays),
      qualifiedPlays: n(d._sum.qualifiedPlays),
      completedPlays: n(d._sum.completedPlays),
      listeningMinutes: Math.round(n(d._sum.totalPlayTimeSeconds) / 60),
      uniqueListeners: n(d._sum.uniqueListeners),
    }));
    const total = (k: "plays" | "qualifiedPlays" | "completedPlays" | "listeningMinutes") => series.reduce((s, d) => s + d[k], 0);

    return {
      days,
      totals: {
        plays: total("plays"),
        qualifiedPlays: total("qualifiedPlays"),
        completedPlays: total("completedPlays"),
        listeningMinutes: total("listeningMinutes"),
        followers,
        newFollowers,
      },
      series,
      topEpisodes: perEpisode.map((e) => ({
        episodeId: e.episodeId,
        title: titleOf.get(e.episodeId) ?? "Épisode supprimé",
        plays: n(e._sum.plays),
        completedPlays: n(e._sum.completedPlays),
      })),
      episodesByStatus: episodes.map((e) => ({ status: e.status, count: e._count.id })),
    };
  }
}
