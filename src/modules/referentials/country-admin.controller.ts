import { Response } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import { sendSuccess, sendError } from "../../utils/response.js";

// ISO 3166-1 alpha-2 codes. Display names come from the runtime's French locale data.
const CODES="AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
const names=new Intl.DisplayNames(["fr"],{type:"region"});
export const countryCatalog=()=>CODES.map(code=>({id:code,code,name:names.of(code)||code})).sort((a,b)=>a.name.localeCompare(b.name,"fr"));

export class CountryAdminController {
  static async catalog(_req:AuthenticatedRequest,res:Response){return sendSuccess(res,countryCatalog());}
  static async create(req:AuthenticatedRequest,res:Response){
    try{
      const {code}=z.object({code:z.string().trim().toUpperCase().refine(code=>CODES.includes(code),"Choisissez un pays dans la liste.")}).parse(req.body);
      const name=names.of(code)!;
      // Adding a catalogue country does not activate creator signup or publishing there.
      const country=await prisma.$transaction(async tx=>{
        const result=await tx.country.upsert({where:{code},create:{id:code,code,name},update:{}});
        await tx.auditLog.create({data:{actorId:req.user!.id,action:"COUNTRY_REGISTERED",entityType:"Country",entityId:result.id,newState:{code,name:result.name},ipAddress:req.ip}});
        return result;
      });
      return sendSuccess(res,country);
    }catch(e){return sendError(res,e instanceof z.ZodError?"Choisissez un pays valide dans la liste.":"Impossible d’ajouter le pays. Réessayez.",e instanceof z.ZodError?"VALIDATION_ERROR":"COUNTRY_CREATE_FAILED",e instanceof z.ZodError?400:500);}
  }
}
