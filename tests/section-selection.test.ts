import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/prisma.js';
import { SectionSelectionService } from '../src/modules/recommendations/section-selection.service.js';
import { PersonalizationEngineService } from '../src/modules/recommendations/personalization-engine.service.js';
import { CandidateSelectorService } from '../src/modules/recommendations/candidate-selector.service.js';
import { UserProfileService } from '../src/modules/recommendations/user-profile.service.js';
import { DiscoveryService } from '../src/modules/discovery/discovery.service.js';
import { HeroService } from '../src/modules/discovery/hero.service.js';

test('section rules preserve country/category and filter actual dates, durations and publishing cadence', async () => {
  const now = new Date('2026-10-14T12:00:00Z');
  const recent = await SectionSelectionService.rule('new-podcasts', 'FR', 'science', now);
  const serialized = JSON.stringify(recent?.where);
  assert.match(serialized, /"countryId":"FR"/);
  assert.match(serialized, /science/);
  assert.match(serialized, /2026-09-14T12:00:00.000Z/);
  assert.match(serialized, /createdAt/);
  const short = await SectionSelectionService.rule('short-episodes', 'FR', 'science', now);
  assert.match(JSON.stringify(short?.where), /"lt":1200/);
  assert.match(JSON.stringify(short?.where), /"gt":0/);
  const originalGroup = prisma.episode.groupBy;
  let query: any;
  try {
    prisma.episode.groupBy = (async (args: any) => { query = args; return [{ podcastId: 'regular' }]; }) as any;
    const active = await SectionSelectionService.rule('active-podcasts', 'FR', 'science', now);
    assert.equal(query.having.podcastId._count.gte, 3);
    assert.match(JSON.stringify(query.where), /publishedAt/);
    assert.match(JSON.stringify(query.where), /FR/);
    assert.match(JSON.stringify(active?.where), /"in":\["regular"\]/);
  } finally { prisma.episode.groupBy = originalGroup; }
});

test('personalized pages keep a ranked selection snapshot rather than querying the whole catalogue', async () => {
  const originalProfile = UserProfileService.getOrBuildProfile;
  const originalCandidates = CandidateSelectorService.selectEpisodeCandidates;
  const originalFind = prisma.episode.findMany;
  let candidateCalls = 0;
  const profile: any = { userId: 'listener', personalizationActive: true,
    categoryScores: { science: 10 }, languageScores: {},
    recentSignals: { recentCompletions: [], quickAbandons: [], repeatedListens: {} } };
  const episodes: any[] = [
    { id: 'unrelated', podcastId: 'p1', title: 'Other', podcast: { id: 'p1', categories: [] } },
    { id: 'relevant', podcastId: 'p2', title: 'Science', podcast: { id: 'p2', categories: [{ categoryId: 'science' }] } },
  ];
  try {
    PersonalizationEngineService.invalidateUserCache('listener');
    UserProfileService.getOrBuildProfile = (async () => profile) as any;
    CandidateSelectorService.selectEpisodeCandidates = (async (received: any) => {
      assert.equal(received, profile); candidateCalls++; return episodes;
    }) as any;
    prisma.episode.findMany = (async (args: any) => {
      assert.deepEqual(args.where.id.in.sort(), ['relevant', 'unrelated']);
      assert.equal(args.where.status, 'PUBLISHED');
      return episodes;
    }) as any;
    const first = await PersonalizationEngineService.getSectionDetails('for-you', {
      userId: 'listener', batchId: 'stable-test', limit: 1,
    });
    const second = await PersonalizationEngineService.getSectionDetails('for-you', {
      userId: 'listener', batchId: 'stable-test', offset: 1, limit: 1,
    });
    assert.equal(first?.items[0].episode?.id, 'relevant');
    assert.equal(second?.items[0].episode?.id, 'unrelated');
    assert.equal(first?.pagination.total, 2);
    assert.equal(second?.pagination.hasMore, false);
    assert.equal(candidateCalls, 1, 'next page uses the same ranked snapshot');
  } finally {
    UserProfileService.getOrBuildProfile = originalProfile;
    CandidateSelectorService.selectEpisodeCandidates = originalCandidates;
    prisma.episode.findMany = originalFind;
    PersonalizationEngineService.invalidateUserCache('listener');
  }
});

test('section count and pages use the same scope; empty editorial selection never becomes the catalogue', async () => {
  const count = prisma.podcast.count;
  const find = prisma.podcast.findMany;
  const editorial = prisma.editorialSectionItem.findMany;
  const episodes = prisma.episode.findMany;
  let countWhere: any;
  let pageQuery: any;
  try {
    prisma.podcast.count = (async (args: any) => { countWhere = args.where; return 23; }) as any;
    prisma.podcast.findMany = (async (args: any) => {
      pageQuery = args; return [{ id: 'eligible', name: 'Recent', slug: 'recent' }];
    }) as any;
    const page = await PersonalizationEngineService.getSectionDetails('section_new_podcasts', {
      countryId: 'FR', category: 'science', offset: 20, limit: 3,
    });
    assert.deepEqual(countWhere, pageQuery.where);
    assert.equal(pageQuery.skip, 20);
    assert.equal(pageQuery.take, 3);
    assert.equal(page?.pagination.total, 23);
    assert.equal(page?.pagination.hasMore, true);
    assert.equal(page?.items[0].position, 20);
    assert.match(page?.section.subtitle || '', /30/);
    prisma.editorialSectionItem.findMany = (async () => []) as any;
    prisma.episode.findMany = (async (args: any) => {
      assert.deepEqual(args.where.AND[1].id.in, [], 'must explicitly restrict to curated IDs');
      return [];
    }) as any;
    const empty = await PersonalizationEngineService.getSectionDetails('editorial-selection');
    assert.deepEqual(empty?.items, []);
    assert.equal(empty?.pagination.total, 0);
    assert.equal(empty?.pagination.hasMore, false);
  } finally {
    prisma.podcast.count = count; prisma.podcast.findMany = find;
    prisma.editorialSectionItem.findMany = editorial; prisma.episode.findMany = episodes;
  }
});

test('home delegates previews to section rules and removes empty selections', async () => {
  const originals = [prisma.editorialSection.findMany, CandidateSelectorService.selectEpisodeCandidates,
    CandidateSelectorService.selectPodcastCandidates, CandidateSelectorService.selectFeedEpisodes,
    DiscoveryService.getTrendingPodcasts, HeroService.build, PersonalizationEngineService.getSectionDetails,
    prisma.recommendationBatch.create] as const;
  const requested: string[] = [];
  try {
    PersonalizationEngineService.invalidateUserCache();
    prisma.editorialSection.findMany = (async () => []) as any;
    CandidateSelectorService.selectEpisodeCandidates = async () => [];
    CandidateSelectorService.selectPodcastCandidates = async () => [];
    CandidateSelectorService.selectFeedEpisodes = (async () => ({ items: [], hasMore: false, nextCursor: null })) as any;
    DiscoveryService.getTrendingPodcasts = async () => [];
    HeroService.build = async () => [];
    prisma.recommendationBatch.create = (async () => ({})) as any;
    PersonalizationEngineService.getSectionDetails = (async (slug: string, options: any) => {
      requested.push(slug);
      assert.equal(options.countryId, 'FR');
      return { section: { title: 'Recent only', subtitle: 'Last 30 days', type: 'PODCAST_ROW',
        discoveryContext: { targetUrl: `/discovery/sections/${slug}` } },
        items: slug === 'new-podcasts' ? [{ id: 'recent-item', targetType: 'PODCAST', position: 0,
          podcast: { id: 'recent', name: 'Recent only' } }] : [],
        pagination: { total: slug === 'new-podcasts' ? 1 : 0, hasMore: false } };
    }) as any;
    const home = await PersonalizationEngineService.getPersonalizedHome(undefined, 'home-rule-test', 'FR');
    assert.ok(requested.includes('active-podcasts'));
    assert.ok(requested.includes('editorial-selection'));
    assert.equal(home.sections.length, 1);
    assert.equal(home.sections[0].slug, 'new-podcasts');
    assert.equal(home.sections[0].items[0].podcast?.id, 'recent');
    assert.equal(home.sections[0].type, 'PODCAST_ROW');
  } finally {
    [prisma.editorialSection.findMany, CandidateSelectorService.selectEpisodeCandidates,
      CandidateSelectorService.selectPodcastCandidates, CandidateSelectorService.selectFeedEpisodes,
      DiscoveryService.getTrendingPodcasts, HeroService.build, PersonalizationEngineService.getSectionDetails,
      prisma.recommendationBatch.create] = originals as any;
    PersonalizationEngineService.invalidateUserCache();
  }
});
