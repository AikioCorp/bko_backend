import test from 'node:test';
import assert from 'node:assert/strict';
import { CountryAdminController, countryCatalog } from '../src/modules/referentials/country-admin.controller.js';
import { prisma } from '../src/config/prisma.js';

test('country catalogue contains Benin and canonical country names',()=>{
 const countries=countryCatalog();assert.equal(countries.find(c=>c.code==='BJ')?.name,'Bénin');
 assert.ok(countries.some(c=>c.code==='TG'));assert.ok(countries.length>240);
 assert.equal(new Set(countries.map(c=>c.code)).size,countries.length);
});
test('country registration validates the code, is idempotent, and never activates a market',async()=>{
 const transaction=prisma.$transaction;let calls=0;const registered=new Map();
 prisma.$transaction=(async(callback:any)=>callback({country:{upsert:async({where,create,update}:any)=>{calls++;assert.deepEqual(update,{});assert.equal(where.code,create.code);assert.equal(create.market,undefined);if(!registered.has(where.code))registered.set(where.code,create);return registered.get(where.code);}},auditLog:{create:async()=>({})}})) as any;
 let status=200,payload:any;const response:any={status:(value:number)=>{status=value;return response;},json:(value:any)=>{payload=value;return response;}};
 try{
  await CountryAdminController.create({user:{id:'admin'},body:{code:' bj '}} as any,response);assert.equal(status,200);assert.equal(payload.data.id,'BJ');assert.equal(payload.data.name,'Bénin');
  await CountryAdminController.create({user:{id:'admin'},body:{code:'BJ'}} as any,response);assert.equal(registered.size,1);
  await CountryAdminController.create({user:{id:'admin'},body:{code:'ZZ'}} as any,response);assert.equal(status,400);assert.equal(calls,2);
 }finally{prisma.$transaction=transaction;}
});
