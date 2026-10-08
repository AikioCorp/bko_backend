import { StorageProvider, PresignedUploadResult, ObjectMetadata } from "./storage.interface.js";
import { mkdir, stat, rm, rename } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Real disk storage for local development. Never selected in production. */
export class LocalMockStorageProvider implements StorageProvider {
  private root = resolve(process.cwd(), ".local-media");
  private tickets = new Map<string, {key:string;contentType:string;expires:number}>();
  private base = process.env.LOCAL_API_BASE_URL || "http://localhost:8080/api/v1";
  filePath(key:string):string {
    const path=resolve(this.root,key);
    if(!key || !path.startsWith(this.root+sep)) throw new Error("Invalid storage key");
    return path;
  }
  async createPresignedUploadUrl(storageKey:string,contentType:string,expiresInSeconds=3600):Promise<PresignedUploadResult> {
    this.filePath(storageKey);
    const token=randomUUID();const expiresAt=new Date(Date.now()+expiresInSeconds*1000);
    this.tickets.set(token,{key:storageKey,contentType,expires:expiresAt.getTime()});
    return {storageKey,expiresAt,uploadUrl:`${this.base}/mock-storage/upload?token=${token}`};
  }
  async receiveUpload(token:string,stream:Readable):Promise<void> {
    const ticket=this.tickets.get(token);
    if(!ticket || ticket.expires<Date.now()) throw new Error("Upload expired or invalid");
    this.tickets.delete(token);
    const path=this.filePath(ticket.key);const temporary=path+".partial-"+randomUUID();
    await mkdir(dirname(path),{recursive:true});
    let size=0;
    const limit=new Transform({transform(chunk,encoding,callback){size+=chunk.length;callback(size>2000*1024*1024?new Error("File too large"):null,chunk);}});
    try { await pipeline(stream,limit,createWriteStream(temporary));if(size===0) throw new Error("Empty file");await rename(temporary,path); }
    catch(error){await rm(temporary,{force:true});throw error;}
  }
  async createPresignedDownloadUrl(key:string):Promise<string> {this.filePath(key);return `${this.base}/mock-storage/file?key=${encodeURIComponent(key)}`;}
  async objectExists(key:string):Promise<boolean> {return Boolean(await this.getMetadata(key));}
  async getMetadata(key:string):Promise<ObjectMetadata|null> {
    try {const info=await stat(this.filePath(key));return info.isFile()?{sizeBytes:BigInt(info.size),contentType:"application/octet-stream",lastModified:info.mtime}:null;}
    catch {return null;}
  }
  async deleteObject(key:string):Promise<void> {await rm(this.filePath(key),{force:true});}
}
