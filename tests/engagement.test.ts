import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../src/config/prisma.js";
import { EngagementService as service } from "../src/modules/interactions/engagement.service.js";

function replaceMethod(ctx: any, target: any, name: string, implementation: (...args: any[]) => any) {
  const original = target[name];
  let current = implementation;
  target[name] = (...args: any[]) => current(...args);
  ctx.after(() => { target[name] = original; });
  return { mock: { mockImplementation(fn: (...args: any[]) => any) { current = fn; } } };
}

// All database calls are mocked. No environment file or database is needed.
test("engagement validation and access rules", async (t) => {
  await t.test("rejects invalid ratings before querying", async () => {
    for (const score of [0, 6, 2.5, NaN, "5", true]) {
      await assert.rejects(service.ratePodcast("podcast", "user", score as number), /entier/);
    }
  });
  await t.test("rejects malformed pagination", async () => {
    for (const [limit, offset] of [[NaN, 0], [20, -1], [1.5, 0], [20, NaN]]) {
      await assert.rejects(service.listComments("episode", limit, offset), /Pagination/);
    }
  });
  await t.test("requires an actual boolean", async () => {
    await assert.rejects(service.updateCommentSettings("episode", "false" as any, "user"), /booléen/);
  });
  await t.test("rejects empty, oversized and non-text comments", async () => {
    for (const text of ["  ", "x".repeat(2001), null, {}]) {
      await assert.rejects(service.createComment("episode", "user", text as string));
    }
  });
  await t.test("does not expose ratings of unpublished podcasts", async (ctx) => {
    replaceMethod(ctx, prisma.podcast, "findUnique", async () => ({ status: "DRAFT" }));
    await assert.rejects(service.getPodcastRatings("podcast"), /introuvable/);
    ctx.mock.restoreAll();
  });
  await t.test("blocks comments when closed or parent unpublished", async (ctx) => {
    const lookup = replaceMethod(ctx, prisma.episode, "findUnique", async () => ({
      status: "PUBLISHED", allowComments: false, podcast: { status: "PUBLISHED" },
    }));
    await assert.rejects(service.createComment("episode", "user", "Bonjour"), /fermés/);
    lookup.mock.mockImplementation(async () => ({
      status: "PUBLISHED", allowComments: true, podcast: { status: "DRAFT" },
    }));
    await assert.rejects(service.createComment("episode", "user", "Bonjour"), /introuvable/);
    await assert.rejects(service.likeEpisode("episode", "user"), /introuvable/);
    ctx.mock.restoreAll();
  });
  await t.test("ordinary members cannot change comment settings", async (ctx) => {
    replaceMethod(ctx, prisma.episode, "findUnique", async () => ({ podcastId: "podcast" }));
    replaceMethod(ctx, prisma.podcastMember, "findUnique", async () => ({ role: "EDITOR" }));
    replaceMethod(ctx, prisma.userRole, "findMany", async () => []);
    await assert.rejects(service.updateCommentSettings("episode", false, "user"), /non autorisée/);
    ctx.mock.restoreAll();
  });
});
