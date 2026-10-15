import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../src/config/prisma.js';
import { supportRouter } from '../src/modules/users/support.routes.js';
import { PermissionService } from '../src/services/permission.service.js';
import { JWT_SECRET } from '../src/config/jwt.js';

test('support: private conversation, staff permissions, closure, email outbox', async () => {
  const originals = {transaction:prisma.$transaction,find:prisma.supportTicket.findUnique,user:prisma.user.findUnique,access:PermissionService.getAccess};
  let ticket:any; const jobs:any[]=[]; const notifications:any[]=[]; const messages:any[]=[];
  const tx:any={
    $queryRaw:async()=>[],userRole:{findMany:async()=>[{user:{id:'agent',email:'agent@example.com',isSuspended:false}}]},
    supportTicket:{create:async({data}:any)=>{ticket={...data,status:'OPEN',createdAt:new Date(),updatedAt:new Date()};messages.push({id:'first',body:data.messages.create.body,kind:'USER'});return ticket;},findUniqueOrThrow:async()=>ticket,update:async({data}:any)=>(ticket={...ticket,...data,status:data.status||ticket.status})},
    supportMessage:{create:async({data}:any)=>messages.push({id:String(messages.length),...data})},
    notification:{createMany:async({data}:any)=>notifications.push(...data)},
    auditLog:{create:async()=>({})},jobQueueItem:{create:async({data}:any)=>{jobs.push(data);return data;}},
  };
  prisma.$transaction=(async(fn:any)=>fn(tx)) as any;
  prisma.supportTicket.findUnique=(async({where}:any)=>where.id===ticket?.id?{...ticket,messages}:null) as any;
  prisma.user.findUnique=(async()=>({email:'user@example.com',isSuspended:false})) as any;
  PermissionService.getAccess=async(id:string)=>({isSuper:false,permissions:new Set(id==='agent'?['support.view','support.edit']:[]),roles:[]});
  const app=express();app.use(express.json());app.use(supportRouter);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const address=server.address() as any;const base=`http://127.0.0.1:${address.port}`;
  const request=async(path:string,body?:any,headers:any={})=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,json:await r.json() as any};};
  const auth=(id:string)=>({'Authorization':`Bearer ${jwt.sign({id,email:`${id}@example.com`},JWT_SECRET)}`});
  try {
    assert.equal((await request('/support/tickets',{email:'bad',subject:'x',description:'x'})).status,400);
    const created=await request('/support/tickets',{email:'user@example.com',subject:'Compte bloqué',description:'Je souhaite une révision.'});
    assert.equal(created.status,201);const id=created.json.data.id,key=created.json.data.accessToken;
    assert.equal(created.json.data.accessHash,undefined);assert.equal(jobs.length,2);assert.equal(notifications[0].userId,'agent');assert.equal(notifications[0].link,`/admin/support?ticket=${id}`);
    assert.equal((await request(`/support/tickets/${id}`)).status,404);
    const hdr={'X-Support-Key':key};assert.equal((await request(`/support/tickets/${id}`,undefined,hdr)).status,200);
    assert.equal((await request(`/support/tickets/${id}/messages`,{status:'CLOSED'},hdr)).status,404);
    assert.equal((await request(`/admin/support-tickets/${id}`,undefined,auth('stranger'))).status,403);
    assert.equal((await request(`/admin/support-tickets/${id}/messages`,{body:'Nous examinons votre demande.'},auth('agent'))).status,200);
    assert.equal(messages.at(-1).kind,'STAFF');assert.equal(jobs.length,4);
    assert.equal((await request(`/admin/support-tickets/${id}/messages`,{status:'CLOSED'},auth('agent'))).status,200);
    assert.equal((await request(`/support/tickets/${id}/messages`,{body:'Merci'},hdr)).status,409);
    const count=jobs.length;await request(`/admin/support-tickets/${id}/messages`,{status:'CLOSED'},auth('agent'));assert.equal(jobs.length,count,'no duplicate close emails');
    assert.equal((await request(`/admin/support-tickets/${id}/messages`,{status:'OPEN'},auth('agent'))).status,200);
    assert.equal((await request(`/support/tickets/${id}/messages`,{body:'Merci'},hdr)).status,200);
    assert.ok(jobs.every(j=>j.queueName==='emails'&&j.maxAttempts===5));
    assert.ok(jobs[2].payload.html.includes('#key='),'reply emails preserve ticket access for signed-out users');
    prisma.user.findUnique=(async()=>({email:'blocked@example.com',isSuspended:true})) as any;
    const appeal=await request('/support/tickets',{subject:'Révision de compte',description:'Mon compte est suspendu.'},auth('blocked'));
    assert.equal(appeal.status,201,'a suspended identity can contact support');
    assert.equal(appeal.json.data.userId,'blocked');
    assert.equal((await request(`/support/tickets/${appeal.json.data.id}`,undefined,auth('blocked'))).status,200,'suspended owner can follow their ticket');
    assert.equal((await request(`/admin/support-tickets/${appeal.json.data.id}`,undefined,auth('blocked'))).status,403,'suspension still prevents administrative access');
  } finally {
    server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
    prisma.$transaction=originals.transaction;prisma.supportTicket.findUnique=originals.find;prisma.user.findUnique=originals.user;PermissionService.getAccess=originals.access;
  }
});
