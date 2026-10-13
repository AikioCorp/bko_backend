import assert from 'node:assert/strict';
import test from 'node:test';
import { HeroService } from '../src/modules/discovery/hero.service.js';

// Isolate selection rules from database access and popularity aggregation.
const service = HeroService as any;
service.mostListened = async () => [];
service.topRated = async () => [];
service.latestOfPodcasts = async () => [];
const episodes = Array.from({ length: 14 }, (_, i) => ({
  id: `ep-${i}`, podcastId: `pod-${i}`, podcast: { id: `pod-${i}` },
}));

test('refresh prioritises alternatives and keeps one episode per show', async () => {
  const initial = await HeroService.build(undefined, episodes, [], { seed: 'initial' });
  const previousIds = initial.map(s => s.episode.id);
  const refreshed = await HeroService.build(undefined, episodes, [], { seed: 'refresh', previousIds });
  assert.ok(refreshed.length >= 5);
  assert.ok(refreshed.every(s => !previousIds.includes(s.episode.id)));
  assert.equal(new Set(refreshed.map(s => s.episode.podcastId)).size, refreshed.length);
});

test('small catalogues reuse relevant items rather than disappear', async () => {
  const pool = episodes.slice(0, 2);
  const refreshed = await HeroService.build(undefined, pool, [], {
    seed: 'refresh', previousIds: pool.map(e => e.id),
  });
  assert.equal(refreshed.length, 2);
});

test('normal requests with the same seed retain a stable selection', async () => {
  const a = await HeroService.build(undefined, episodes, [], { seed: 'stable' });
  const b = await HeroService.build(undefined, episodes, [], { seed: 'stable' });
  assert.deepEqual(a.map(s => s.episode.id), b.map(s => s.episode.id));
});
