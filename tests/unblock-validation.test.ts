import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminConsoleController } from '../src/modules/admin/admin-console.controller.js';
import { AdminRbacService } from '../src/modules/admin/admin-rbac.service.js';

test('reactivation accepts null reason sent by the account detail page', async()=>{
  const original=AdminRbacService.setUserSuspension;
  let received:any;
  AdminRbacService.setUserSuspension=(async(...args:any[])=>{received=args;return {userId:args[1],isSuspended:args[2],suspendedReason:null};}) as any;
  let status=200,json:any;const res:any={status:(n:number)=>{status=n;return res;},json:(v:any)=>{json=v;return res;}};
  try {
    await AdminConsoleController.setUserSuspension({user:{id:'admin'},params:{id:'person'},body:{suspended:false,reason:null}} as any,res);
    assert.equal(status,200);assert.equal(json.success,true);assert.equal(received[2],false);assert.equal(received[3],undefined);
  }finally{AdminRbacService.setUserSuspension=original;}
});
