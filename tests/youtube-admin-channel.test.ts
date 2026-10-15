import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/prisma.js';
import { AdminYouTubeController } from '../src/modules/admin/admin-youtube.controller.js';

function response(){return {code:200,body:null as any,status(code:number){this.code=code;return this;},json(body:any){this.body=body;return this;}};}

test('editing channel metadata preserves paused status and existing import settings',async()=>{
 const find=prisma.youtubeChannelSync.findUnique,update=prisma.youtubeChannelSync.update;
 let stored:any;
 prisma.youtubeChannelSync.findUnique=(async()=>({syncEnabled:false,syncStatus:'PAUSED',importSettings:{autoPublish:true,filterKeywords:['culture']}})) as any;
 prisma.youtubeChannelSync.update=(async({data}:any)=>{stored=data;return data;}) as any;
 try{
  const res=response();await AdminYouTubeController.updateSettings({params:{podcastId:'podcast'},body:{channelTitle:' Nouveau nom '}} as any,res as any);
  assert.equal(res.code,200);assert.equal(stored.channelTitle,'Nouveau nom');assert.equal(stored.syncStatus,'PAUSED');assert.equal(stored.syncEnabled,false);assert.equal(stored.importSettings.autoPublish,true);assert.deepEqual(stored.importSettings.filterKeywords,['culture']);assert.equal('nextSyncAt' in stored,false);
  stored=null;const invalid=response();await AdminYouTubeController.updateSettings({params:{podcastId:'podcast'},body:{channelId:'another-channel'}} as any,invalid as any);assert.equal(invalid.code,400);assert.equal(stored,null);
 }finally{prisma.youtubeChannelSync.findUnique=find;prisma.youtubeChannelSync.update=update;}
});

test('channel video pagination and count use the same channel and search criteria',async()=>{
 const find=prisma.youtubeChannelSync.findUnique,list=prisma.youtubeImportedVideo.findMany,count=prisma.youtubeImportedVideo.count;
 let listing:any,counting:any;
 prisma.youtubeChannelSync.findUnique=(async()=>({id:'channel-sync'})) as any;
 prisma.youtubeImportedVideo.findMany=(async(args:any)=>{listing=args;return [];}) as any;
 prisma.youtubeImportedVideo.count=(async(args:any)=>{counting=args;return 29;}) as any;
 try{
  const res=response();await AdminYouTubeController.listVideos({params:{podcastId:'podcast'},query:{page:'2',q:'culture'}} as any,res as any);
  assert.equal(res.code,200);assert.equal(listing.skip,25);assert.equal(listing.take,25);assert.equal(listing.where.youtubeChannelId,'channel-sync');assert.deepEqual(listing.where,counting.where);assert.equal(res.body.data.total,29);
  const invalid=response();await AdminYouTubeController.listVideos({params:{podcastId:'podcast'},query:{page:'-1'}} as any,invalid as any);assert.equal(invalid.code,400);
 }finally{prisma.youtubeChannelSync.findUnique=find;prisma.youtubeImportedVideo.findMany=list;prisma.youtubeImportedVideo.count=count;}
});
