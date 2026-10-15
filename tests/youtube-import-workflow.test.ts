import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/prisma.js';
import { YouTubeCatalogService } from '../src/modules/youtube/youtube-catalog.service.js';
import { YouTubeChannelService } from '../src/modules/youtube/youtube-channel.service.js';
import { YouTubeResolverService } from '../src/modules/youtube/youtube-resolver.service.js';
import { YouTubeWorkerService } from '../src/modules/youtube/youtube-worker.service.js';
import { SsrfProtectionService } from '../src/services/ssrf-protection.service.js';
import { RssParserService } from '../src/modules/rss/rss-parser.service.js';

const channelId='UC'+'a'.repeat(22),videoId='a'.repeat(11),otherId='b'.repeat(11);
const channel={channelId,title:'Chaîne test',description:'',feedUrl:`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,uploadsPlaylistId:'UU'+'a'.repeat(22)};
const video=(id=videoId,date='2026-10-15T12:00:00Z'):any=>({guid:id,title:'Entretien',description:'Culture et sciences',pubDate:new Date(date),enclosureUrl:`https://www.youtube.com/watch?v=${id}`,enclosureType:'video/youtube',enclosureLength:null,durationSeconds:3600,durationKnown:true,seasonNumber:null,episodeNumber:null,keywords:[],mediaType:'VIDEO',provider:'YOUTUBE',youtubeVideoId:id,fingerprint:id,embeddable:true});

test('official catalogue paginates beyond 15 and validates video channel ownership',async()=>{
 const fetch=globalThis.fetch,key=process.env.YOUTUBE_API_KEY;process.env.YOUTUBE_API_KEY='test-only';let wrong=false;
 globalThis.fetch=(async(input:any)=>{const url=new URL(String(input));let data:any;
  if(url.pathname.endsWith('/channels'))data={items:[{contentDetails:{relatedPlaylists:{uploads:'canonical-playlist'}}}]};
  else if(url.pathname.endsWith('/playlistItems')){assert.equal(url.searchParams.get('pageToken'),'page-two');assert.equal(url.searchParams.get('maxResults'),'50');data={nextPageToken:'page-three',pageInfo:{totalResults:120},items:Array.from({length:30},(_,i)=>({contentDetails:{videoId:String(i).padStart(11,'0')}}))};}
  else {assert.ok(url.searchParams.get('part')?.includes('status'));data={items:url.searchParams.get('id')!.split(',').map(id=>({id,snippet:{channelId:wrong?'wrong':channelId,title:'Entretien',description:'',publishedAt:'2026-10-15T12:00:00Z'},contentDetails:{duration:'PT1H2M'},status:{embeddable:true}}))};}
  return new Response(JSON.stringify(data),{status:200});}) as any;
 try{const page=await YouTubeCatalogService.page(channelId,'page-two');assert.equal(page.items.length,30);assert.equal(page.totalResults,120);assert.equal(page.nextPageToken,'page-three');assert.equal(page.items[0].durationSeconds,3720);wrong=true;await assert.rejects(()=>YouTubeCatalogService.videos([videoId],channelId),/VIDEO_CHANNEL_MISMATCH/);}
 finally{globalThis.fetch=fetch;if(key===undefined)delete process.env.YOUTUBE_API_KEY;else process.env.YOUTUBE_API_KEY=key;}
});

test('connection rejects empty selection, respects paused sync, and supports future-only mode',async()=>{
 const saved={member:prisma.podcastMember.findUnique,podcast:prisma.podcast.findUnique,find:prisma.youtubeChannelSync.findUnique,upsert:prisma.youtubeChannelSync.upsert,job:prisma.jobQueueItem.create,resolve:YouTubeResolverService.resolveChannel};let stored:any;const jobs:any[]=[];
 prisma.podcastMember.findUnique=(async()=>({role:'OWNER'})) as any;prisma.podcast.findUnique=(async()=>({id:'podcast'})) as any;
 prisma.youtubeChannelSync.findUnique=(async()=>null) as any;prisma.youtubeChannelSync.upsert=(async({create}:any)=>(stored={id:'sync',...create})) as any;
 prisma.jobQueueItem.create=(async({data}:any)=>{jobs.push(data);return data;}) as any;YouTubeResolverService.resolveChannel=async()=>channel;
 try{
  await assert.rejects(()=>YouTubeChannelService.connectChannel('owner','podcast',{...channel,channelTitle:channel.title,selectedVideoIds:[]}),/EMPTY_SELECTION/);assert.equal(jobs.length,0);
  await YouTubeChannelService.connectChannel('owner','podcast',{...channel,channelTitle:channel.title,selectedVideoIds:[videoId],settings:{autoSyncFuture:false,includeKeywords:['science']}});
  assert.equal(stored.syncEnabled,false);assert.equal(stored.nextSyncAt,null);assert.deepEqual(stored.importSettings.filterKeywords,['science']);assert.deepEqual(jobs[0].payload.selectedVideoIds,[videoId]);assert.equal(stored.importSettings.autoPublish,false);
  await YouTubeChannelService.connectChannel('owner','podcast',{...channel,channelTitle:channel.title,selectedVideoIds:[],settings:{initialImportMode:'FUTURE_ONLY',autoSyncFuture:false}});assert.equal(jobs.length,1,'future-only never schedules an old-video import');
 }finally{prisma.podcastMember.findUnique=saved.member;prisma.podcast.findUnique=saved.podcast;prisma.youtubeChannelSync.findUnique=saved.find;prisma.youtubeChannelSync.upsert=saved.upsert;prisma.jobQueueItem.create=saved.job;YouTubeResolverService.resolveChannel=saved.resolve;}
});

test('worker imports selected archives missing from Atom and does not block future uploads after SELECT',async()=>{
 const key=process.env.YOUTUBE_API_KEY;process.env.YOUTUBE_API_KEY='test-only';
 const saved={channel:prisma.youtubeChannelSync.findUnique,podcast:prisma.podcast.findUnique,runCreate:prisma.youtubeSyncRun.create,runUpdate:prisma.youtubeSyncRun.update,channelUpdate:prisma.youtubeChannelSync.update,safeFetch:SsrfProtectionService.safeFetch,parse:RssParserService.parseXml,videos:YouTubeCatalogService.videos,page:YouTubeCatalogService.page,process:(YouTubeWorkerService as any).processVideoItem};
 let metadata=[video()],processed:string[]=[],updates:any[]=[];
 prisma.youtubeChannelSync.findUnique=(async()=>({id:'sync',podcastId:'podcast',channelId,feedUrl:channel.feedUrl,syncEnabled:true,createdAt:new Date('2026-10-01'),importSettings:{importScope:'SELECT',filterKeywords:['science'],futureSince:'2026-10-01T00:00:00Z'}})) as any;
 prisma.podcast.findUnique=(async()=>({id:'podcast'})) as any;prisma.youtubeSyncRun.create=(async()=>({id:'run'})) as any;prisma.youtubeSyncRun.update=(async({data}:any)=>{updates.push(data);return data;}) as any;prisma.youtubeChannelSync.update=(async()=>({})) as any;
 SsrfProtectionService.safeFetch=(async()=>({status:200,text:'xml'})) as any;RssParserService.parseXml=(()=>({items:metadata})) as any;YouTubeCatalogService.videos=async ids=>ids.map(id=>video(id));YouTubeCatalogService.page=async()=>({items:metadata,nextPageToken:null,totalResults:metadata.length});
 (YouTubeWorkerService as any).processVideoItem=async(_sync:any,_pod:any,item:any)=>{processed.push(item.youtubeVideoId);return 'imported';};
 try{
  await YouTubeWorkerService.handleSync('sync','podcast',[otherId],true);assert.deepEqual(processed,[otherId],'selected video is fetched directly, outside recent feed');
  processed=[];await YouTubeWorkerService.handleSync('sync','podcast',undefined,false);assert.deepEqual(processed,[videoId],'legacy SELECT does not block a new publication');assert.equal(updates.at(-1).videosImported,1);
  processed=[];metadata=[{...video(),embeddable:false}];YouTubeCatalogService.videos=async()=>metadata;
  await YouTubeWorkerService.handleSync('sync','podcast',[videoId],true);assert.equal(processed.length,0);assert.equal(updates.at(-1).status,'PARTIAL');assert.equal(updates.at(-1).videosFailed,1);
 }finally{if(key===undefined)delete process.env.YOUTUBE_API_KEY;else process.env.YOUTUBE_API_KEY=key;prisma.youtubeChannelSync.findUnique=saved.channel;prisma.podcast.findUnique=saved.podcast;prisma.youtubeSyncRun.create=saved.runCreate;prisma.youtubeSyncRun.update=saved.runUpdate;prisma.youtubeChannelSync.update=saved.channelUpdate;SsrfProtectionService.safeFetch=saved.safeFetch;RssParserService.parseXml=saved.parse;YouTubeCatalogService.videos=saved.videos;YouTubeCatalogService.page=saved.page;(YouTubeWorkerService as any).processVideoItem=saved.process;}
});

test('archive selection schedules an import without altering channel settings',async()=>{
 const saved={find:prisma.youtubeChannelSync.findUnique,member:prisma.podcastMember.findUnique,job:prisma.jobQueueItem.create,videos:YouTubeCatalogService.videos};let queued:any;let allowed=true;
 prisma.youtubeChannelSync.findUnique=(async()=>({id:'sync',channelId,syncEnabled:false,importSettings:{autoPublish:false}})) as any;
 prisma.podcastMember.findUnique=(async()=>allowed?{role:'OWNER'}:null) as any;
 prisma.jobQueueItem.create=(async({data}:any)=>{queued=data;return data;}) as any;
 YouTubeCatalogService.videos=async()=>[video()];
 try{
  const result=await YouTubeChannelService.historicalImport('owner','podcast',{selectedVideoIds:[videoId]});
  assert.equal(result.syncStatus,'PENDING');assert.deepEqual(queued.payload.selectedVideoIds,[videoId]);
  assert.equal(queued.jobType,'YOUTUBE_INITIAL_IMPORT');
  await assert.rejects(()=>YouTubeChannelService.historicalImport('owner','podcast',{selectedVideoIds:[] }));
  allowed=false;await assert.rejects(()=>YouTubeChannelService.historicalImport('stranger','podcast',{selectedVideoIds:[videoId]}),/FORBIDDEN/);
 }finally{prisma.youtubeChannelSync.findUnique=saved.find;prisma.podcastMember.findUnique=saved.member;prisma.jobQueueItem.create=saved.job;YouTubeCatalogService.videos=saved.videos;}
});
