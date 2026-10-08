import { prisma } from "../../config/prisma.js";

function normalizeString(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export class SearchService {
  static async searchAll(query: string, limit = 20) {
    if (!query || query.trim().length === 0) {
      return {
        podcasts: [],
        episodes: [],
        people: [],
        topics: [],
        organizations: [],
        passages: [],
      };
    }

    const searchTerm = query.trim();

    // Recherche parallèle multi-entités (Podcasts, Épisodes, Personnes, Topics, Organisations, Passages/Transcripts)
    const [podcasts, episodes, people, topics, organizations, matchingSegments] = await Promise.all([
      // 1. Podcasts
      prisma.podcast.findMany({
        where: {
          status: "PUBLISHED",
          OR: [
            { name: { contains: searchTerm, mode: "insensitive" } }, { slug: { contains: searchTerm.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’\s]+/g, '-'), mode: "insensitive" } },
            { description: { contains: searchTerm, mode: "insensitive" } },
            { alternateTitles: { some: { title: { contains: searchTerm, mode: "insensitive" } } } },
          ],
        },
        include: {
          country: true,
          primaryLanguage: true,
          categories: { include: { category: true } },
          _count: { select: { episodes: true, followers: true } },
        },
        take: limit,
      }),

      // 2. Épisodes
      prisma.episode.findMany({
        where: {
          status: "PUBLISHED",
          OR: [
            { title: { contains: searchTerm, mode: "insensitive" } }, { slug: { contains: searchTerm.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’\s]+/g, '-'), mode: "insensitive" } },
            { description: { contains: searchTerm, mode: "insensitive" } },
          ],
        },
        include: {
          podcast: { include: { country: true, primaryLanguage: true } },
          mediaSources: true,
        },
        take: limit,
      }),

      // 3. Personnes
      prisma.person.findMany({
        where: {
          OR: [
            { name: { contains: searchTerm, mode: "insensitive" } }, { slug: { contains: searchTerm.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’\s]+/g, '-'), mode: "insensitive" } },
            { aliases: { some: { alias: { contains: searchTerm, mode: "insensitive" } } } },
          ],
        },
        include: {
          country: true,
          aliases: true,
          _count: { select: { episodeAppearances: true, podcastAppearances: true } },
        },
        take: limit,
      }),

      // 4. Topics
      prisma.topic.findMany({
        where: {
          OR: [
            { name: { contains: searchTerm, mode: "insensitive" } }, { slug: { contains: searchTerm.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’\s]+/g, '-'), mode: "insensitive" } },
            { description: { contains: searchTerm, mode: "insensitive" } },
            { aliases: { some: { alias: { contains: searchTerm, mode: "insensitive" } } } },
          ],
        },
        include: {
          aliases: true,
          _count: { select: { podcasts: true, episodes: true } },
        },
        take: limit,
      }),

      // 5. Organisations
      prisma.organization.findMany({
        where: {
          OR: [
            { name: { contains: searchTerm, mode: "insensitive" } }, { slug: { contains: searchTerm.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’\s]+/g, '-'), mode: "insensitive" } },
            { description: { contains: searchTerm, mode: "insensitive" } },
          ],
        },
        include: {
          _count: { select: { podcasts: true } },
        },
        take: limit,
      }),

      // 6. Passages d'Épisodes (Recherche dans les Transcriptions)
      prisma.transcriptSegment.findMany({
        where: {
          transcript: { visibility: "PUBLIC", status: "READY" },
          text: { contains: searchTerm, mode: "insensitive" },
        },
        include: {
          transcript: {
            include: {
              episode: {
                include: {
                  podcast: { select: { name: true, slug: true, cover: true } },
                },
              },
            },
          },
        },
        take: limit,
        orderBy: { startTimeMs: "asc" },
      }),
    ]);

    const passages = matchingSegments.map((s) => ({
      segmentId: s.id,
      podcastName: s.transcript.episode.podcast.name,
      podcastSlug: s.transcript.episode.podcast.slug,
      episodeId: s.transcript.episode.id,
      episodeTitle: s.transcript.episode.title,
      episodeSlug: s.transcript.episode.slug,
      cover: s.transcript.episode.podcast.cover,
      startTimeMs: s.startTimeMs,
      timestampSec: Math.floor(s.startTimeMs / 1000),
      formattedTime: formatTimestamp(s.startTimeMs),
      text: s.text,
      speakerLabel: s.speakerLabel || "Intervenant",
      deepLinkUrl: `/podcasts/${s.transcript.episode.podcast.slug}/episodes/${s.transcript.episode.slug}?t=${Math.floor(s.startTimeMs / 1000)}`,
    }));

    return {
      podcasts,
      episodes,
      people,
      topics,
      organizations,
      passages,
    };
  }

  static async getSuggestions(query: string, limit = 5) {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const searchTerm = query.trim();

    const [podcasts, people, topics, episodes] = await Promise.all([
      prisma.podcast.findMany({
        where: {
          status: "PUBLISHED",
          OR: [
            { name: { contains: searchTerm, mode: "insensitive" } }, { slug: { contains: searchTerm.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’\s]+/g, '-'), mode: "insensitive" } },
            { alternateTitles: { some: { title: { contains: searchTerm, mode: "insensitive" } } } },
          ],
        },
        select: { id: true, name: true, slug: true, cover: true },
        take: limit,
      }),
      prisma.person.findMany({
        where: {
          OR: [
            { name: { contains: searchTerm, mode: "insensitive" } }, { slug: { contains: searchTerm.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’\s]+/g, '-'), mode: "insensitive" } },
            { aliases: { some: { alias: { contains: searchTerm, mode: "insensitive" } } } },
          ],
        },
        select: { id: true, name: true, slug: true, photo: true },
        take: limit,
      }),
      prisma.topic.findMany({
        where: {
          OR: [
            { name: { contains: searchTerm, mode: "insensitive" } }, { slug: { contains: searchTerm.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’\s]+/g, '-'), mode: "insensitive" } },
            { aliases: { some: { alias: { contains: searchTerm, mode: "insensitive" } } } },
          ],
        },
        select: { id: true, name: true, slug: true },
        take: limit,
      }),
      prisma.episode.findMany({
        where: {
          status: "PUBLISHED",
          title: { contains: searchTerm, mode: "insensitive" },
        },
        select: {
          id: true,
          title: true,
          slug: true,
          podcast: { select: { slug: true, name: true } },
        },
        take: limit,
      }),
    ]);

    const suggestions: Array<{ id: string; title: string; type: string; url: string; image?: string | null }> = [];

    podcasts.forEach((p) =>
      suggestions.push({ id: p.id, title: p.name, type: "podcast", url: `/podcasts/${p.slug}`, image: p.cover })
    );

    people.forEach((p) =>
      suggestions.push({ id: p.id, title: p.name, type: "person", url: `/people/${p.slug}`, image: p.photo })
    );

    topics.forEach((t) =>
      suggestions.push({ id: t.id, title: t.name, type: "topic", url: `/topics/${t.slug}` })
    );

    episodes.forEach((e) =>
      suggestions.push({
        id: e.id,
        title: e.title,
        type: "episode",
        url: `/podcasts/${e.podcast.slug}/episodes/${e.slug}`,
      })
    );

    return suggestions.slice(0, limit * 2);
  }
}
