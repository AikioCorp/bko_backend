import { prisma } from "../src/config/prisma.js";
import { RssWorkerService } from "../src/modules/rss/rss-worker.service.js";
import { AdminRssController } from "../src/modules/admin/admin-rss.controller.js";
import { Request, Response } from "express";

async function runRssImportTests() {
  if (!process.env.DATABASE_URL?.includes("localhost") && !process.env.DATABASE_URL?.includes("127.0.0.1") && !process.env.DATABASE_URL?.includes("5437")) {
    console.error("Safety abort: Do not run destructive E2E tests on a remote production DB.");
    process.exit(1);
  }
  console.log("=================================================");
  console.log("🚀 DÉMARRAGE DU TEST D'IMPORT RSS ADMIN");
  console.log("=================================================\n");

  let passed = 0;
  let total = 0;

  function test(name: string, fn: () => Promise<void> | void) {
    total++;
    return Promise.resolve()
      .then(() => fn())
      .then(() => {
        console.log(`  ✅ PASSED: ${name}`);
        passed++;
      })
      .catch((e) => {
        console.log(`  ❌ FAILED: ${name}`);
        console.error(e);
      });
  }

  // Cleanup
  const testPodcasts = await prisma.podcast.findMany({ 
    where: { name: { startsWith: "Afropod Test" } } 
  });
  for (const p of testPodcasts) {
    const feeds = await prisma.rssFeed.findMany({ where: { podcastId: p.id } });
    for (const f of feeds) {
      await prisma.jobQueueItem.deleteMany({ where: { queueName: "rss-importer", payload: { path: ["rssFeedId"], equals: f.id } } });
    }
    await prisma.podcast.delete({ where: { id: p.id } });
  }

  let operationId: string;
  let podcastId: string;
  let rssFeedId: string;

  await test("1. createImport correctly initializes DB and Job", async () => {
    let responseData: any = null;
    let statusCode = 200;
    
    const req = {
      body: {
        url: "https://anchor.fm/s/1005b6228/podcast/rss",
        name: "Afropod Test",
        importSettings: {
          importScope: "LAST_10",
          newEpisodesTreatment: "DRAFT",
          keepManualEdits: true
        }
      }
    } as unknown as Request;

    const res = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (data: any) => {
        responseData = data;
        return res;
      }
    } as unknown as Response;

    await AdminRssController.createImport(req, res);

    if (statusCode !== 202) throw new Error("Expected 202, got " + statusCode + JSON.stringify(responseData));
    if (!responseData.success) throw new Error("Expected success true");
    if (!responseData.data.operationId) throw new Error("No operationId returned");
    
    operationId = responseData.data.operationId;
    podcastId = responseData.data.podcastId;
    rssFeedId = operationId;

    const job = await prisma.jobQueueItem.findFirst({
      where: { queueName: "rss-importer" }
    });
    
    if (!job) throw new Error("Job not created");
    if (job.status !== "PENDING") throw new Error("Job status is not PENDING");
  });

  await test("2. getImportStatus returns PENDING status initially", async () => {
     let responseData: any = null;
     
     const req = { params: { id: operationId } } as unknown as Request;
     const res = {
       status: () => res,
       json: (data: any) => { responseData = data; return res; }
     } as unknown as Response;

     await AdminRssController.getImportStatus(req, res);
     
     if (!responseData.success) throw new Error("Expected success true");
     if (responseData.data.status !== "PENDING") throw new Error("Status is not PENDING");
  });

  await test("3. Worker processes the import and tracks real progress", async () => {
    const result = await RssWorkerService.processNextJob();
    if (result !== true) throw new Error("processNextJob returned false or didn't process");

    const rssFeed = await prisma.rssFeed.findUnique({ where: { id: rssFeedId } });
    if (rssFeed?.syncStatus !== "IDLE") throw new Error("Feed syncStatus is not IDLE, it is " + rssFeed?.syncStatus);

    const run = await prisma.rssSyncRun.findFirst({ where: { rssFeedId } });
    if (!run) throw new Error("RssSyncRun not created");
    if (run.status !== "SUCCESS") throw new Error("Run status is not SUCCESS");
    if (run.episodesImported === 0) throw new Error("No episodes imported");
    
    if (run.episodesImported > 10) throw new Error("More than 10 episodes imported, but scope was LAST_10");
  });

  await test("4. Duplicate import returns error", async () => {
    let responseData: any = null;
    
    const req = {
      body: {
        url: "https://anchor.fm/s/1005b6228/podcast/rss",
        name: "Afropod Test 2",
      }
    } as unknown as Request;

    const res = {
      status: () => res,
      json: (data: any) => { responseData = data; return res; }
    } as unknown as Response;

    await AdminRssController.createImport(req, res);

    if (responseData.success !== false) throw new Error("Expected error for duplicate URL");
    if (!responseData.error.includes("existe déjà")) throw new Error("Expected 'existe déjà' message");
  });

  console.log(`\n✅ BILAN: ${passed} / ${total} TESTS RÉUSSIS`);
  console.log("=================================================");

  if (passed !== total) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runRssImportTests();
