import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prisma} from '../src/config/prisma.js';
import {DiscoveryService} from '../src/modules/discovery/discovery.service.js';
import {PodcastService} from '../src/modules/podcasts/podcast.service.js';
test('category shelves only query published podcasts with published episodes and filtered counts',async()=>{
 const original=prisma.category.findMany;
 (prisma.category as any).findMany=async(q:any)=>{
   const filter=q.where.podcasts.some.podcast;
   assert.equal(filter.status,'PUBLISHED');assert.equal(filter.episodes.some.status,'PUBLISHED');assert.equal(filter.countryId,'ML');
   assert.deepEqual(q.include.podcasts.where.podcast,filter);
   assert.deepEqual(q.include._count.select.podcasts.where.podcast,filter);
   assert.equal(q.include.podcasts.take,8);assert.equal(q.take,12);
   return [{id:'culture',slug:'culture',name:'Culture',_count:{podcasts:1},podcasts:[{podcast:{id:'podcast'}}]}];
 };
 try{const shelves=await DiscoveryService.getCategoryShelves('ML');assert.equal(shelves[0].count,1);assert.equal(shelves[0].podcasts[0].id,'podcast');}
 finally{prisma.category.findMany=original;}
});
test('catalog cursor points to the last returned podcast without skipping the next result',async()=>{
 const original=prisma.podcast.findMany;
 (prisma.podcast as any).findMany=async()=>[{id:'first'},{id:'second'},{id:'next'}];
 try{const result=await PodcastService.getPodcasts({limit:2});assert.deepEqual(result.data.map(p=>p.id),['first','second']);assert.equal(result.pagination.nextCursor,'second');assert.equal(result.pagination.hasMore,true);}
 finally{prisma.podcast.findMany=original;}
});
