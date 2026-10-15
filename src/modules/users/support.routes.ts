import { Router, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { randomUUID, createHmac, createHash } from "node:crypto";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { prisma } from "../../config/prisma.js";
import { authenticateToken, AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import { requirePermission } from "../../middlewares/permission.middleware.js";
import { sendSuccess, sendError } from "../../utils/response.js";

import { JWT_SECRET } from "../../config/jwt.js";
const accessKey = (id:string) => createHmac("sha256", JWT_SECRET).update(`support:${id}`).digest("hex");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const bodySchema = z.object({subject:z.string().trim().min(3).max(180),description:z.string().trim().min(10).max(10000),category:z.string().max(80).optional(),origin:z.enum(["WEB","MOBILE"]).default("WEB"),email:z.string().email().max(254).optional()});
export const supportRouter = Router();
const limit = rateLimit({windowMs:15*60*1000,limit:120,standardHeaders:true,legacyHeaders:false});
const createLimit = rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:true,legacyHeaders:false});
// Suspension must not prevent contacting support. This identity is accepted ONLY here;
// administrative routes continue to use normal authentication and live permissions.
const supportIdentity:RequestHandler = async (req:AuthenticatedRequest,res,next)=>{
  try {
    const raw=req.get("Authorization")?.replace(/^Bearer /i,"");
    if(raw){const decoded=jwt.verify(raw,JWT_SECRET) as any;
      const user=await prisma.user.findUnique({where:{id:decoded.id},select:{id:true,email:true}});
      if(user)req.user={id:decoded.id,email:user.email,roles:[]};
    }
  }catch { /* Public ticket access still requires its confidential key. */ }
  next();
};
const requireSupportIdentity:RequestHandler=(req:AuthenticatedRequest,res,next)=>req.user?next():sendError(res,"Connectez-vous pour consulter vos demandes.","UNAUTHORIZED",401);
const safe = (ticket: any) => { const {accessHash, ...data}=ticket; return {...data,ticketId:data.id}; };
// Email jobs are committed with the ticket mutation; worker failures do not lose notifications.
async function notify(tx: any, ticket: any, event: string, key?: string) {
  const roles = await tx.userRole.findMany({where:{role:{OR:[{name:"SUPER_ADMIN"},{rolePermissions:{some:{permission:{code:"support.view"}}}}]}},select:{user:{select:{email:true,isSuspended:true}}}});
  const admins = [...new Set<string>(roles.filter((r:any)=>!r.user.isSuspended).map((r:any)=>r.user.email))];
  const base = (process.env.APP_URL || "https://www.bamakopodcast.studio").replace(/\/$/,"");
  key = key || accessKey(ticket.id);
  const userLink = `${base}/support?ticket=${encodeURIComponent(ticket.id)}${key?`#key=${key}`:""}`;
  for(const to of new Set([ticket.email,...admins])) {
    const link = to===ticket.email ? userLink : `${base}/admin/support?ticket=${ticket.id}`;
    const text = `${event}\n${ticket.subject}\nRéférence : ${ticket.id}\nConsultez et répondez au ticket : ${link}\nNe répondez pas à cet email automatique.`;
    await tx.jobQueueItem.create({data:{queueName:"emails",jobType:"SEND_EMAIL",payload:{to,subject:`[BKO Support] ${event} — ${ticket.id}`,text,html:`<p>${escape(event)}</p><p>${escape(ticket.subject)}</p><p>Référence : ${escape(ticket.id)}</p><p><a href="${escape(link)}">Consulter le ticket</a></p><p>Ne répondez pas à cet email automatique.</p>`},maxAttempts:5}});
  }
}
function wrap(fn: (req: AuthenticatedRequest)=>Promise<any>, status=200) {
  return async(req:any,res:any)=>{try{return sendSuccess(res,await fn(req),undefined,status);}catch(e:any){if(e instanceof z.ZodError)return sendError(res,"Vérifiez les champs du formulaire.","VALIDATION_ERROR",400,e.flatten());const code=e.message;return sendError(res,code==="CLOSED"?"Ce ticket est fermé.":"Opération impossible.",code,["NOT_FOUND","CLOSED"].includes(code)?(code==="CLOSED"?409:404):500);}};
}
supportRouter.post(["/support/tickets", "/me/support-tickets"],createLimit,supportIdentity,wrap(async req=>{
  const data=bodySchema.parse(req.body);
  const user=req.user?await prisma.user.findUnique({where:{id:req.user.id},select:{email:true}}):null;
  const email=user?.email || data.email;
  if(!email)throw new z.ZodError([{code:"custom",path:["email"],message:"Email requis"}]);
  const id=randomUUID();
  const key=accessKey(id);
  const ticket=await prisma.$transaction(async tx=>{
    const t=await tx.supportTicket.create({data:{id,userId:req.user?.id,email,subject:data.subject,category:data.category,origin:data.origin,accessHash:hash(key),messages:{create:{body:data.description,authorId:req.user?.id}}}});
    await notify(tx,t,"Demande reçue",key);return t;
  });return {...safe(ticket),accessToken:key};
},201));
supportRouter.get("/me/support-tickets",supportIdentity,requireSupportIdentity,wrap(async req=>({items:(await prisma.supportTicket.findMany({where:{userId:req.user!.id},orderBy:{updatedAt:"desc"},take:100})).map(safe)})));

async function access(req: AuthenticatedRequest, admin=false) {
  const ticket=await prisma.supportTicket.findUnique({where:{id:String(req.params.id)},include:{messages:{orderBy:[{createdAt:"asc"},{id:"asc"}]}}});
  const key=req.get("X-Support-Key");
  if(!ticket || (!admin && !(req.user && ticket.userId===req.user.id) && !(key && hash(key)===ticket.accessHash)))throw new Error("NOT_FOUND");
  return ticket;
}
supportRouter.get("/support/tickets/:id",limit,supportIdentity,wrap(async req=>safe(await access(req))));
function mutate(admin:boolean) {return wrap(async req=>{
  const data=z.object({body:z.string().trim().min(1).max(10000).optional(),status:z.enum(["OPEN","CLOSED"]).optional()}).refine(d=>!!d.body || !!d.status).parse(req.body);
  const old=await access(req,admin);
  if(!admin && data.status)throw new Error("NOT_FOUND");
  return prisma.$transaction(async tx=>{
    // Serialize replies and closure, preventing a reply racing past a close.
    await tx.$queryRaw`SELECT id FROM "SupportTicket" WHERE id = ${old.id} FOR UPDATE`;
    const current=await tx.supportTicket.findUniqueOrThrow({where:{id:old.id}});
    if(data.body && current.status==="CLOSED")throw new Error("CLOSED");
    if(data.status===current.status && !data.body)return safe(current);
    await tx.supportMessage.create({data:{ticketId:old.id,authorId:req.user?.id,kind:data.status?"SYSTEM":admin?"STAFF":"USER",body:data.body || (data.status==="CLOSED"?"Ticket fermé par l’assistance.":"Ticket rouvert par l’assistance.")}});
    const ticket=await tx.supportTicket.update({where:{id:old.id},data:{status:data.status,updatedAt:new Date()}});
    await notify(tx,ticket,data.status==="CLOSED"?"Ticket fermé":data.status==="OPEN"?"Ticket rouvert":"Nouvelle réponse",req.get("X-Support-Key") || undefined);
    await tx.auditLog.create({data:{actorId:req.user?.id,action:"SUPPORT_UPDATED",entityType:"SUPPORT_TICKET",entityId:old.id,newState:{status:ticket.status,staff:admin}}});
    return safe(ticket);
  });
});}
supportRouter.post("/support/tickets/:id/messages",limit,supportIdentity,mutate(false));
supportRouter.get("/admin/support-tickets",authenticateToken,requirePermission("support.view"),wrap(async req=>{
  const page=Math.max(1,Math.min(10000,Number(req.query.page)||1));
  const status=z.enum(["OPEN","CLOSED"]).optional().parse(req.query.status || undefined);
  const where={status}; const [items,total]=await Promise.all([prisma.supportTicket.findMany({where,orderBy:[{updatedAt:"desc"},{id:"asc"}],take:25,skip:(page-1)*25}),prisma.supportTicket.count({where})]);
  return {items:items.map(safe),total,page};
}));
supportRouter.get("/admin/support-tickets/:id",authenticateToken,requirePermission("support.view"),wrap(async req=>safe(await access(req,true))));
supportRouter.post("/admin/support-tickets/:id/messages",authenticateToken,requirePermission("support.edit"),mutate(true));
