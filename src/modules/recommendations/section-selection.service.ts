import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

export const sectionAliases: Record<string, string> = {
  section_discover_podcasts: 'discover-podcasts', section_voices_discover: 'voices-discover',
  section_new_podcasts: 'new-podcasts', section_active_podcasts: 'active-podcasts',
  section_popular_now: 'popular-now', section_featured_episodes: 'for-you',
  section_bko_editorial: 'editorial-selection', section_start_podcast: 'start-podcast',
  section_rediscover: 'rediscover', section_lang_selection: 'lang-selection',
  section_topic_selection: 'topic-selection', section_conversations: 'conversations-interviews',
  section_new_episodes: 'new-episodes', section_short_episodes: 'short-episodes',
  section_long_episodes: 'long-episodes',
};
export const sectionTitles: Record<string, [string, string]> = {
  'new-podcasts': ['Nouvelles émissions', 'Émissions ajoutées au cours des 30 derniers jours'],
  'voices-discover': ['Des voix à découvrir', 'Émissions indépendantes ajoutées au cours des 90 derniers jours'],
  'active-podcasts': ['Les émissions qui publient régulièrement', 'Au moins 3 épisodes publiés au cours des 60 derniers jours'],
  'popular-now': ['Émissions suivies par la communauté', 'Émissions ayant des abonnés, classées par nombre de suivis'],
  'short-episodes': ['À écouter en moins de 20 minutes', 'Épisodes de moins de 20 minutes'],
  'long-episodes': ['Les formats longs à explorer', 'Épisodes de 40 minutes ou plus'],
  'new-episodes': ['Nouveaux épisodes', 'Épisodes publiés au cours des 30 derniers jours'],
  'rediscover': ['À redécouvrir', 'Épisodes de nos archives publiés depuis au moins 6 mois'],
  'lang-selection': ['Sélection en Bamanankan', 'Épisodes ou émissions déclarés en Bamanankan'],
  'topic-selection': ['Focus Société et Culture', 'Épisodes des catégories Société et Culture'],
  'conversations-interviews': ['Conversations et interviews', 'Épisodes dont le titre ou la description annonce un entretien ou un dialogue'],
  'start-podcast': ['Pour commencer une émission', 'Premier épisode publié de chaque émission'],
  'editorial-selection': ['La sélection BKO', 'Épisodes inclus dans les sélections éditoriales actives'],
  'discover-podcasts': ['Émissions à découvrir', 'Une sélection classée par notre moteur de découverte'],
  'for-you': ['Pour vous', 'Une sélection selon vos goûts et vos écoutes'],
};

/** Rules shared by the home preview and the complete section, never a catalogue fallback. */
export class SectionSelectionService {
  static podcastBase(country?: string, category?: string): Prisma.PodcastWhereInput {
    return { status: 'PUBLISHED', episodes: { some: { status: 'PUBLISHED' } },
      ...(country && country !== 'all' ? { countryId: country } : {}),
      ...(category && category !== 'all' ? { categories: { some: { category: {
        OR: [{ id: category }, { slug: category }, { name: { equals: category, mode: 'insensitive' } }],
      } } } } : {}),
    };
  }

  static async rule(slug: string, country?: string, category?: string, now = new Date()) {
    const since = (days: number) => new Date(now.getTime() - days * 86400000);
    const podcast = this.podcastBase(country, category);
    const base: Prisma.EpisodeWhereInput = { status: 'PUBLISHED', podcast };
    let target: 'PODCAST' | 'EPISODE' = 'EPISODE';
    let where: Prisma.EpisodeWhereInput | Prisma.PodcastWhereInput = base;
    let ids: string[] | undefined;
    switch (slug) {
      case 'new-podcasts':
        target = 'PODCAST'; where = { AND: [podcast, { createdAt: { gte: since(30), lte: now } }] }; break;
      case 'voices-discover':
        target = 'PODCAST'; where = { AND: [podcast, { createdAt: { gte: since(90), lte: now }, organizationId: null }] }; break;
      case 'active-podcasts': {
        const groups = await prisma.episode.groupBy({ by: ['podcastId'],
          where: { AND: [base, { publishedAt: { gte: since(60), lte: now } }] },
          _count: { podcastId: true }, having: { podcastId: { _count: { gte: 3 } } },
        });
        target = 'PODCAST'; where = { AND: [podcast, { id: { in: groups.map(row => row.podcastId) } }] }; break;
      }
      case 'popular-now':
        target = 'PODCAST'; where = { AND: [podcast, { followers: { some: {} } }] }; break;
      case 'short-episodes': where = { AND: [base, { durationSeconds: { gt: 0, lt: 1200 } }] }; break;
      case 'long-episodes': where = { AND: [base, { durationSeconds: { gte: 2400 } }] }; break;
      case 'new-episodes': where = { AND: [base, { publishedAt: { gte: since(30), lte: now } }] }; break;
      case 'rediscover': where = { AND: [base, { publishedAt: { lte: since(180) } }] }; break;
      case 'lang-selection': where = { AND: [base, { OR: [{ languageCode: 'bm' }, { podcast: { primaryLanguageCode: 'bm' } }] }] }; break;
      case 'topic-selection': where = { AND: [base, { podcast: { categories: { some: { category: {
        OR: [{ slug: { in: ['societe', 'culture', 'societe-culture'] } },
          { name: { contains: 'Société', mode: 'insensitive' } }, { name: { contains: 'Culture', mode: 'insensitive' } }],
      } } } } }] }; break;
      case 'conversations-interviews': where = { AND: [base, { OR: ['interview', 'entretien', 'conversation', 'dialogue'].map(word => ({
        OR: [{ title: { contains: word, mode: 'insensitive' as const } }, { description: { contains: word, mode: 'insensitive' as const } }],
      })) }] }; break;
      case 'start-podcast': {
        const first = await prisma.episode.findMany({ where: base, distinct: ['podcastId'],
          orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }], select: { id: true } });
        ids = first.map(ep => ep.id); where = { AND: [base, { id: { in: ids } }] }; break;
      }
      case 'editorial-selection': {
        const selected = await prisma.editorialSectionItem.findMany({
          where: { episode: base, section: { isActive: true, AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
          ] } }, orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { episodeId: true },
        });
        ids = [...new Set(selected.map(item => item.episodeId).filter((id): id is string => Boolean(id)))];
        where = { AND: [base, { id: { in: ids } }] }; break;
      }
      default: return null;
    }
    return { target, where, ids };
  }
}
