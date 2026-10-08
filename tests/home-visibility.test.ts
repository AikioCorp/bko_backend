import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../src/config/prisma.js";
import { DiscoveryController } from "../src/modules/discovery/discovery.controller.js";
import { DiscoveryService } from "../src/modules/discovery/discovery.service.js";

test("home latest and featured episodes require a published parent podcast", async () => {
  const original = prisma.episode.findMany;
  const sections = DiscoveryService.getHomeSections;
  const trending = DiscoveryService.getTrendingPodcasts;
  const shelves = DiscoveryService.getCategoryShelves;
  let queries = 0;
  let response: any;
  (prisma.episode as any).findMany = async (query: any) => {
    assert.equal(query.where.status, "PUBLISHED");
    assert.equal(query.where.podcast.status, "PUBLISHED");
    queries++;
    return [];
  };
  DiscoveryService.getHomeSections = async () => [];
  DiscoveryService.getTrendingPodcasts = async () => [];
  DiscoveryService.getCategoryShelves = async () => [];
  const res: any = { status() { return this; }, json(data: any) { response = data; return this; } };
  try {
    await DiscoveryController.getHome({ query: {} } as any, res);
    assert.equal(response.success, true);
    assert.equal(queries, 2);
    assert.deepEqual(response.data.latestEpisodes, []);
    assert.equal(response.data.heroEpisode, null);
  } finally {
    prisma.episode.findMany = original;
    DiscoveryService.getHomeSections = sections;
    DiscoveryService.getTrendingPodcasts = trending;
    DiscoveryService.getCategoryShelves = shelves;
  }
});
