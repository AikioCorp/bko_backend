import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/config/prisma.js";
import { AdminEpisodeService } from "../src/modules/admin/admin-episode.service.js";

test("admin episode lookup only references existing RSS fields", async () => {
  const original = prisma.episode.findFirst;
  const fieldNames = (model: string) => new Set(
    Prisma.dmmf.datamodel.models.find(m => m.name === model)!.fields.map(f => f.name),
  );
  let checked = false;
  (prisma.episode as any).findFirst = async (query: any) => {
    const rssFields = fieldNames("RssFeed");
    for (const key of Object.keys(query.include.podcast.select.rssFeed.select)) {
      assert.ok(rssFields.has(key), `Unknown RssFeed field: ${key}`);
    }
    const importedFields = fieldNames("RssImportedEpisode");
    for (const order of query.include.rssImportedEpisodes.orderBy) {
      for (const key of Object.keys(order)) assert.ok(importedFields.has(key), `Unknown imported episode field: ${key}`);
    }
    checked = true;
    return null;
  };
  try {
    assert.equal(await AdminEpisodeService.get("missing-test-episode"), null);
    assert.ok(checked);
  } finally {
    prisma.episode.findFirst = original;
  }
});

test("publication inherits podcast language but rejects absence of both", async () => {
  const original = AdminEpisodeService.get;
  const episode: any = {
    mediaSources: [], id: "test", title: "Test episode", podcastId: "podcast", languageCode: null,
    podcast: { status: "PUBLISHED", primaryLanguageCode: "fr" },
    sources: { audioState: "READY", audio: { id: "audio" }, youtube: null },
  };
  AdminEpisodeService.get = async () => episode;
  try {
    assert.equal((await AdminEpisodeService.checklist("test")).ready, true);
    episode.podcast.primaryLanguageCode = null;
    const result = await AdminEpisodeService.checklist("test");
    assert.equal(result.ready, false);
    assert.equal(result.items.find(i => i.key === "language")!.ok, false);
  } finally {
    AdminEpisodeService.get = original;
  }
});


test("publication confirms now and schedule with transactional writes", async () => {
  const originals={checklist:AdminEpisodeService.checklist,get:AdminEpisodeService.get,transaction:prisma.$transaction};
  const {AuditService}=await import("../src/services/audit.service.js");
  const audit=AuditService.logAction;
  const full:any={id:"test",status:"DRAFT",podcast:{primaryLanguageCode:"fr"}};
  const writes:any[]=[];
  AdminEpisodeService.checklist=async()=>({full,items:[],ready:true});
  AdminEpisodeService.get=async()=>full;
  AuditService.logAction=async()=>undefined as any;
  (prisma as any).$transaction=async(fn:any)=>fn({
    episode:{update:async(q:any)=>{writes.push(q.data);Object.assign(full,q.data);}},
    jobQueueItem:{updateMany:async()=>{},create:async(q:any)=>writes.push(q.data)},
  });
  try {
    assert.equal((await AdminEpisodeService.publish("admin","test",{mode:"now"}))!.status,"PUBLISHED");
    assert.equal(writes[0].languageCode,"fr");
    writes.length=0;
    const at=new Date(Date.now()+3600000).toISOString();
    assert.equal((await AdminEpisodeService.publish("admin","test",{mode:"schedule",publishAt:at}))!.status,"SCHEDULED");
    assert.equal(writes[1].queueName,"episodes-publisher");
    assert.equal(writes[1].runAt.toISOString(),at);
    writes.length=0;
    await assert.rejects(()=>AdminEpisodeService.publish("admin","test",{mode:"schedule",publishAt:"invalid"}));
    assert.equal(writes.length,0);
  } finally {
    AdminEpisodeService.checklist=originals.checklist;AdminEpisodeService.get=originals.get;
    prisma.$transaction=originals.transaction;AuditService.logAction=audit;
  }
});
