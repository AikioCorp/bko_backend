import { prisma } from "../../config/prisma.js";

export type HeroSlide = {
  kind: "resume" | "for_you" | "most_listened" | "top_rated" | "popular" | "new";
  label: string;
  reason?: string;
  episode: any;
};

const episodeInclude = {
  podcast: {
    select: {
      id: true,
      name: true,
      slug: true,
      cover: true,
      primaryLanguageCode: true,
      primaryLanguage: true,
      categories: { include: { category: true } },
    },
  },
  mediaSources: true,
  language: true,
} as const;

const published = { status: "PUBLISHED" as const, podcast: { status: "PUBLISHED" as const } };

/**
 * Construit les slides de la bannière d'accueil.
 * - Visiteur : le plus écouté, populaire, mieux noté, nouveauté.
 * - Connecté : on ajoute "reprendre" et "pour vous" (suivis, catégories
 *   écoutées, thématiques et langues préférées), en tête de rotation.
 * Un seul épisode par podcast.
 */
export class HeroService {
  private static async latestOfPodcasts(podcastIds: string[]) {
    const out: any[] = [];
    for (const podcastId of podcastIds) {
      const ep = await prisma.episode.findFirst({
        where: { ...published, podcastId },
        orderBy: { publishedAt: "desc" },
        include: episodeInclude,
      });
      if (ep) out.push(ep);
    }
    return out;
  }

  private static async mostListened(): Promise<any[]> {
    const rows = (await prisma.$queryRaw`
      SELECT stats."episodeId" AS "episodeId", SUM(stats."plays") AS plays
      FROM "EpisodeDailyStats" stats
      JOIN "Episode" ep ON ep.id = stats."episodeId"
      JOIN "Podcast" p ON p.id = ep."podcastId"
      WHERE stats.date >= CURRENT_DATE - INTERVAL '30 days'
        AND ep.status = 'PUBLISHED' AND p.status = 'PUBLISHED'
      GROUP BY stats."episodeId"
      HAVING SUM(stats."plays") > 0
      ORDER BY plays DESC
      LIMIT 10`) as any[];

    if (rows.length > 0) {
      const ids = rows.map((r) => r.episodeId);
      const eps = await prisma.episode.findMany({ where: { id: { in: ids }, ...published }, include: episodeInclude });
      const byId = new Map(eps.map((e) => [e.id, e]));
      return ids.map((id) => byId.get(id)).filter(Boolean);
    }

    return prisma.episode.findMany({
      where: published,
      orderBy: { histories: { _count: "desc" } },
      take: 10,
      include: episodeInclude,
    });
  }

  private static async topRated(): Promise<any[]> {
    const ratings = await prisma.podcastRating.findMany({ select: { podcastId: true, score: true } });
    const agg = new Map<string, { sum: number; n: number }>();
    for (const r of ratings) {
      const a = agg.get(r.podcastId) || { sum: 0, n: 0 };
      a.sum += r.score;
      a.n += 1;
      agg.set(r.podcastId, a);
    }
    const ranked = [...agg.entries()]
      .map(([id, a]) => ({ id, avg: a.sum / a.n, n: a.n }))
      .sort((x, y) => y.avg - x.avg || y.n - x.n)
      .slice(0, 6)
      .map((x) => x.id);
    return this.latestOfPodcasts(ranked);
  }

  private static async personalized(userId: string) {
    const [follows, history, topicPrefs, langPrefs] = await Promise.all([
      prisma.podcastFollow.findMany({ where: { userId }, select: { podcastId: true } }),
      prisma.playbackHistory.findMany({
        where: { userId },
        orderBy: { lastPlayedAt: "desc" },
        take: 30,
        include: { episode: { include: { podcast: { include: { categories: true } } } } },
      }),
      prisma.userTopicPreference.findMany({ where: { userId }, select: { topicId: true } }),
      prisma.userLanguagePreference.findMany({ where: { userId }, select: { languageCode: true } }),
    ]);

    const followed = new Set(follows.map((f) => f.podcastId));
    const languages = new Set(langPrefs.map((l) => l.languageCode));
    const playedIds = new Set(history.map((h) => h.episodeId));
    const heardPodcasts = new Set(history.map((h) => h.episode?.podcastId).filter(Boolean) as string[]);

    // Catégories pondérées par la récence d'écoute
    const catWeight = new Map<string, number>();
    history.forEach((h, i) => {
      const w = 1 - i / (history.length + 1);
      h.episode?.podcast?.categories?.forEach((c) => catWeight.set(c.categoryId, (catWeight.get(c.categoryId) || 0) + w));
    });

    // Épisodes à reprendre
    const resumeIds = history
      .filter((h) => !h.completed && h.positionSeconds > 30)
      .map((h) => h.episodeId)
      .slice(0, 3);
    const resume = resumeIds.length
      ? await prisma.episode.findMany({ where: { id: { in: resumeIds }, ...published }, include: episodeInclude })
      : [];
    resume.sort((a, b) => resumeIds.indexOf(a.id) - resumeIds.indexOf(b.id));

    // Candidats "pour vous"
    let topicPodcasts = new Set<string>();
    if (topicPrefs.length) {
      const pt = await prisma.podcastTopic.findMany({
        where: { topicId: { in: topicPrefs.map((t) => t.topicId) } },
        select: { podcastId: true },
      });
      topicPodcasts = new Set(pt.map((p) => p.podcastId));
    }

    const pool = await prisma.episode.findMany({
      where: published,
      orderBy: { publishedAt: "desc" },
      take: 80,
      include: episodeInclude,
    });

    const scored = pool
      .filter((e) => !playedIds.has(e.id))
      .map((e) => {
        let score = 0;
        let reason = "";
        if (followed.has(e.podcastId)) {
          score += 5;
          reason = `Vous suivez ${e.podcast?.name}`;
        }
        if (topicPodcasts.has(e.podcastId)) {
          score += 3;
          reason = reason || "Dans vos thématiques préférées";
        }
        let best = 0;
        let bestName = "";
        e.podcast?.categories?.forEach((c: any) => {
          const w = catWeight.get(c.categoryId) || 0;
          if (w > best) {
            best = w;
            bestName = c.category?.name;
          }
        });
        if (best > 0) {
          score += 2 + best;
          reason = reason || `Parce que vous écoutez ${bestName}`;
        }
        if (heardPodcasts.has(e.podcastId)) score += 1;
        if (languages.size && languages.has(e.languageCode || e.podcast?.primaryLanguageCode)) {
          score += 1;
          reason = reason || "Dans votre langue";
        }
        return { e, score, reason };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    return { resume, forYou: scored };
  }

  static async build(userId: string | undefined, latestEpisodes: any[], trending: any[]): Promise<HeroSlide[]> {
    const [most, rated, popular, personal] = await Promise.all([
      this.mostListened().catch(() => []),
      this.topRated().catch(() => []),
      this.latestOfPodcasts((trending || []).slice(0, 6).map((p) => p.id)).catch(() => []),
      userId ? this.personalized(userId).catch(() => null) : Promise.resolve(null),
    ]);

    const queues: Record<string, HeroSlide[]> = {
      resume: (personal?.resume || []).map((episode: any) => ({
        kind: "resume" as const, label: "Reprendre l'écoute", reason: "Vous l'avez commencé", episode,
      })),
      for_you: (personal?.forYou || []).map((x: any) => ({
        kind: "for_you" as const, label: "Pour vous", reason: x.reason, episode: x.e,
      })),
      most_listened: most.map((episode: any) => ({ kind: "most_listened" as const, label: "Le plus écouté", episode })),
      top_rated: rated.map((episode: any) => ({ kind: "top_rated" as const, label: "Les mieux notés", episode })),
      popular: popular.map((episode: any) => ({ kind: "popular" as const, label: "Populaire en ce moment", episode })),
      new: (latestEpisodes || []).map((episode: any) => ({ kind: "new" as const, label: "Nouveauté", episode })),
    };

    const order = userId
      ? ["resume", "for_you", "most_listened", "for_you", "top_rated", "popular", "new"]
      : ["most_listened", "popular", "top_rated", "new", "most_listened", "popular"];

    const usedPodcasts = new Set<string>();
    const slides: HeroSlide[] = [];
    const take = (kind: string) => {
      const q = queues[kind];
      while (q && q.length) {
        const s = q.shift()!;
        const key = s.episode?.podcastId || s.episode?.podcast?.id || s.episode?.id;
        if (usedPodcasts.has(key)) continue;
        usedPodcasts.add(key);
        slides.push(s);
        return true;
      }
      return false;
    };

    for (const kind of order) {
      if (slides.length >= 6) break;
      take(kind);
    }
    // Compléter si nécessaire
    for (const kind of ["for_you", "most_listened", "popular", "top_rated", "new"]) {
      while (slides.length < 5 && take(kind)) { /* remplir */ }
    }
    return slides;
  }
}
