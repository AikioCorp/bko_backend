import { createHash } from "node:crypto";
import { ParsedRssItem } from "../rss/rss-parser.service.js";

export type YoutubeCatalogItem = ParsedRssItem & { embeddable: boolean | null };
export class YouTubeCatalogService {
  static get available() { return !!process.env.YOUTUBE_API_KEY; }
  private static async request(resource:string,params:Record<string,string>) {
    const key=process.env.YOUTUBE_API_KEY;
    if(!key)throw new Error("YOUTUBE_API_KEY_REQUIRED: Configurez la clé YouTube du serveur pour parcourir les archives.");
    const query=new URLSearchParams({...params,key});
    let response:Response;
    try{response=await fetch(`https://www.googleapis.com/youtube/v3/${resource}?${query}`,{signal:AbortSignal.timeout(20000)});}catch{throw new Error("YOUTUBE_UNREACHABLE: YouTube est temporairement inaccessible. Réessayez sans modifier votre sélection.");}
    if(!response.ok)throw new Error(response.status===403?"YOUTUBE_API_UNAVAILABLE: Clé, autorisation ou quota YouTube indisponible. Vérifiez la configuration serveur.":"YOUTUBE_API_ERROR: Impossible de récupérer les vidéos YouTube.");
    return response.json();
  }
  static duration(value:string):number {
    const m=value?.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    return m?Number(m[1]||0)*86400+Number(m[2]||0)*3600+Number(m[3]||0)*60+Number(m[4]||0):0;
  }
  static async videos(ids:string[],channelId:string):Promise<YoutubeCatalogItem[]> {
    const unique=[...new Set(ids)];const result:YoutubeCatalogItem[]=[];
    if(unique.some(id=>!/^[\w-]{11}$/.test(id)))throw new Error("INVALID_VIDEO_SELECTION: Identifiant vidéo invalide.");
    for(let offset=0;offset<unique.length;offset+=50){
      const data=await this.request("videos",{part:"snippet,contentDetails,status",id:unique.slice(offset,offset+50).join(",")});
      for(const video of data.items || []){
        if(video.snippet?.channelId!==channelId)throw new Error("VIDEO_CHANNEL_MISMATCH: Une vidéo sélectionnée appartient à une autre chaîne.");
        const durationSeconds=this.duration(video.contentDetails?.duration);
        const title=video.snippet?.title||"Vidéo YouTube",description=video.snippet?.description||"";
        result.push({guid:video.id,enclosureType:"video/youtube",enclosureLength:null,seasonNumber:null,episodeNumber:null,keywords:[],mediaType:"VIDEO",provider:"YOUTUBE",youtubeChannelId:channelId,title,description,pubDate:video.snippet?.publishedAt?new Date(video.snippet.publishedAt):null,enclosureUrl:`https://www.youtube.com/watch?v=${video.id}`,youtubeVideoId:video.id,thumbnailUrl:video.snippet?.thumbnails?.high?.url||"",durationSeconds,durationKnown:!!video.contentDetails?.duration,fingerprint:createHash("sha256").update(JSON.stringify([title,description,video.snippet?.thumbnails])).digest("hex"),embeddable:video.status?.embeddable??null});
      }
    }
    return result;
  }
  static async page(channelId:string,pageToken?:string) {
    if(!/^UC[\w-]{22}$/.test(channelId))throw new Error("INVALID_CHANNEL_ID");
    // Obtain the canonical uploads playlist instead of relying on a guessed playlist id.
    const channel=await this.request("channels",{part:"contentDetails",id:channelId});
    const playlistId=channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if(!playlistId)throw new Error("YOUTUBE_CHANNEL_NOT_FOUND: Chaîne introuvable ou sans vidéos accessibles.");
    const page=await this.request("playlistItems",{part:"contentDetails",playlistId,maxResults:"50",...(pageToken?{pageToken}:{})});
    const ids=(page.items||[]).map((i:any)=>i.contentDetails?.videoId).filter(Boolean);
    const videos=await this.videos(ids,channelId);
    return {items:videos,nextPageToken:page.nextPageToken||null,totalResults:page.pageInfo?.totalResults??null};
  }
}
