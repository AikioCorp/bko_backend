import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prisma} from '../src/config/prisma.js';
import {AdminEpisodeService} from '../src/modules/admin/admin-episode.service.js';
import {AuditService} from '../src/services/audit.service.js';
test('episode deletion cancels pending jobs and deletes the resolved episode atomically',async()=>{
 const original={find:prisma.episode.findFirst,transaction:prisma.$transaction,audit:AuditService.logAction};
 const calls:any[]=[];
 (prisma.episode as any).findFirst=async()=>({id:'resolved-episode'});
 (prisma as any).$transaction=async(fn:any)=>fn({jobQueueItem:{updateMany:async(q:any)=>calls.push(['cancel',q])},episode:{delete:async(q:any)=>calls.push(['delete',q])}});
 AuditService.logAction=async()=>undefined as any;
 try{
  assert.deepEqual(await AdminEpisodeService.remove('admin','slug'),{id:'resolved-episode'});
  assert.equal(calls[0][1].where.payload.equals,'resolved-episode');
  assert.equal(calls[0][1].data.status,'CANCELLED');
  assert.equal(calls[1][1].where.id,'resolved-episode');
  (prisma.episode as any).findFirst=async()=>null;
  await assert.rejects(()=>AdminEpisodeService.remove('admin','missing'),/Épisode introuvable/);
  assert.equal(calls.length,2);
 }finally{prisma.episode.findFirst=original.find;prisma.$transaction=original.transaction;AuditService.logAction=original.audit;}
});
