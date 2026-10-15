import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canVisitAdmin, firstAdminPage, hasPermission } from '../../bko_web/src/lib/admin-permissions.js';
import { AdminRbacService } from '../src/modules/admin/admin-rbac.service.js';
import { PermissionService } from '../src/services/permission.service.js';
import { NotificationService } from '../src/services/notification.service.js';
import { ALL_PERMISSIONS } from '../src/config/permissions.js';
import { prisma } from '../src/config/prisma.js';

test('staff landing and direct URLs use capabilities, never a role-name bypass',()=>{
 const support={roles:['SUPPORT'],permissions:['support.view','support.edit'],isSuperAdmin:false};
 assert.equal(firstAdminPage(support),'/admin/support');
 assert.equal(canVisitAdmin(support,'/admin/support'),true);
 assert.equal(canVisitAdmin(support,'/admin/users'),false);
 assert.equal(canVisitAdmin(support,'/admin/dashboard'),false);
 assert.equal(hasPermission({...support,permissions:['support.view']},'support.edit'),false);
 assert.equal(canVisitAdmin({roles:['ADMIN'],permissions:[],isSuperAdmin:false},'/admin/users'),false);
 const reader={roles:['READ_ONLY'],permissions:['catalog.view'],isSuperAdmin:false};
 assert.equal(canVisitAdmin(reader,'/admin/podcasts/123'),true);
 assert.equal(canVisitAdmin(reader,'/admin/podcasts/new'),false);
 assert.equal(canVisitAdmin(reader,'/admin/podcasts/123/edit'),false);
 assert.equal(canVisitAdmin(reader,'/admin/podcasts/123/episodes/new'),false);
 assert.equal(canVisitAdmin(reader,'/admin/podcasts-unknown'),false);
 assert.equal(canVisitAdmin(undefined,'/admin/support'),false);
 assert.equal(firstAdminPage({roles:[],permissions:['reviews.view'],isSuperAdmin:false}),'/admin/reviews');
 assert.equal(firstAdminPage({roles:[],permissions:['markets.view'],isSuperAdmin:false}),'/admin/markets');
 assert.equal(canVisitAdmin({roles:['SUPER_ADMIN'],permissions:[],isSuperAdmin:true},'/admin/roles'),true);
});

test('every main admin API route enforces live permissions except the self-access endpoint',()=>{
 const source=readFileSync(new URL('../src/routes/v1/index.ts',import.meta.url),'utf8');
 const routes=source.split('\n').filter(line=>/^router\.(get|post|put|patch|delete)\("\/admin\//.test(line));
 assert.ok(routes.length>70);
 for(const line of routes){if(line.includes('"/admin/access"'))continue;assert.ok(line.includes('requirePermission('),line);}
 assert.ok(ALL_PERMISSIONS.includes('support.view'));assert.ok(ALL_PERMISSIONS.includes('support.edit'));
});

test('system ADMIN role permissions are editable; super role and escalation remain protected',async()=>{
 const saved={access:PermissionService.getAccess,find:prisma.role.findUnique,ids:prisma.permission.findMany,tx:prisma.$transaction,del:prisma.rolePermission.deleteMany,create:prisma.rolePermission.createMany,update:prisma.role.update,audit:prisma.auditLog.create};
 let superActor=true;let roleName='ADMIN';let granted:any[]=[];
 PermissionService.getAccess=async()=>({isSuper:superActor,permissions:new Set(superActor?ALL_PERMISSIONS:['roles.edit','roles.view','support.view']),roles:[]});
 prisma.role.findUnique=(async()=>({id:'admin-role',name:roleName,isSystem:true,rolePermissions:[]})) as any;
 prisma.permission.findMany=(async({where}:any)=>where.code.in.map((code:string)=>({id:code,code}))) as any;
 prisma.rolePermission.deleteMany=(async()=>({count:0})) as any;
 prisma.rolePermission.createMany=(async({data}:any)=>{granted=data;return {count:data.length};}) as any;
 prisma.role.update=(async()=>({})) as any;
 prisma.auditLog.create=(async()=>({})) as any;
 prisma.$transaction=(async(operations:any)=>Promise.all(operations)) as any;
 try {
  await AdminRbacService.updateRole({id:'super'},'admin-role',{permissions:['support.edit']});
  assert.deepEqual(granted.map(x=>x.permissionId).sort(),['support.edit','support.view']);
  roleName='SUPER_ADMIN';await assert.rejects(()=>AdminRbacService.updateRole({id:'super'},'super-role',{permissions:[]}),/SUPER_ADMIN_LOCKED/);
  roleName='SUPPORT';superActor=false;
  await assert.rejects(()=>AdminRbacService.updateRole({id:'limited'},'role',{permissions:['users.delete']}),/PERMISSION_ESCALATION/);
 }finally{PermissionService.getAccess=saved.access;prisma.role.findUnique=saved.find;prisma.permission.findMany=saved.ids;prisma.$transaction=saved.tx;prisma.rolePermission.deleteMany=saved.del;prisma.rolePermission.createMany=saved.create;prisma.role.update=saved.update;prisma.auditLog.create=saved.audit;}
});

test('revoking support access also hides old staff notification bodies and counts',async()=>{
 const saved={access:PermissionService.getAccess,find:prisma.notification.findMany,count:prisma.notification.count};let permitted=true;let where:any;
 PermissionService.getAccess=async()=>({isSuper:false,permissions:new Set(permitted?['support.view']:[]),roles:[]});
 prisma.notification.findMany=(async(args:any)=>{where=args.where;return [];}) as any;
 prisma.notification.count=(async(args:any)=>{assert.equal(args.where.type?.not,permitted?undefined:'SUPPORT_STAFF');return 0;}) as any;
 try {await NotificationService.list('agent',20);assert.equal(where.type,undefined);permitted=false;await NotificationService.list('agent',20);assert.deepEqual(where.type,{not:'SUPPORT_STAFF'});await NotificationService.unreadCount('agent');}
 finally{PermissionService.getAccess=saved.access;prisma.notification.findMany=saved.find;prisma.notification.count=saved.count;}
});
