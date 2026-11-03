import * as fs from "node:fs/promises";
import path from "node:path";
import {StudioStore} from "@ttm/automation";
import {getStore} from "../../../lib/data";
export const dynamic="force-dynamic";
/** Voices of the installed local engines only: VieNeu presets from its SDK asset file, Kokoro voice files on disk. */
export async function GET(){
 const config=await new StudioStore(await getStore()).config(),voices:{id:string;language:string;engine:string;label:string}[]=[];
 if(config.pythonVi){const file=path.join(path.dirname(path.dirname(config.pythonVi)),"Lib","site-packages","vieneu","assets","voices_v3_turbo.json");
  const data=await fs.readFile(file,"utf8").then(JSON.parse,()=>null),presets=data?.presets??{};for(const [id,v] of Object.entries<any>(presets))voices.push({id,language:"vi-VN",engine:"VieNeu-TTS v3 Turbo",label:`${id} · ${v?.description??""}`.trim()});}
 if(config.ttsEnModel){const names=await fs.readdir(path.join(config.ttsEnModel,"voices")).catch(()=>[] as string[]);
  for(const n of names.filter(n=>/^[ab][fm]_[a-z]+\.pt$/.test(n))){const id=n.slice(0,-3);voices.push({id,language:id.startsWith("a")?"en-US":"en-GB",engine:"Kokoro-82M",label:`${id} · ${id[1]==="f"?"female":"male"}`});}}
 return Response.json({voices,defaults:{vi:config.voiceVi,enUs:config.voiceEn,enGb:config.voiceEnGb}},{headers:{"Cache-Control":"no-store"}});
}
