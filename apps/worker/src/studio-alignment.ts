import path from "node:path";
import * as fs from "node:fs/promises";
import {createHash} from "node:crypto";
import {environmentLock,modelStoreLock,type StudioConfig} from "@ttm/automation";
import {writeJsonAtomic,withLock} from "@ttm/storage";
import {runProcess} from "@ttm/media";
import {FactoryError} from "@ttm/core";
import type {Ctx} from "./context.js";
/** Optional explicit CPU adapter. Unsupported languages retain estimated/manual timing. */
export async function alignStudioNarration(ctx:Ctx,config:StudioConfig,language:string,lines:{file:string;text:string}[],requestFile:string){
 const measured=await Promise.all(lines.map(async line=>({...line,file:path.resolve(line.file),audioSha256:createHash("sha256").update(await fs.readFile(line.file)).digest("hex")})));
 if(!config.alignmentModel||!language.startsWith("en"))return{lines:measured,evidence:null};
 const python=config.pythonAsr;if(!python)throw new FactoryError("NEEDS_PROVIDER","HUMAN_REQUIRED","Configure the compatible isolated ASR Python before English alignment");
 const script=path.join(path.dirname(process.env.ACS_ENGINE_RUNNER??path.resolve("engines/runner.py")),"alignment_engine.py");
 await writeJsonAtomic(requestFile,{language,device:"cpu",lines:measured,config},{keepBackup:false});
 const execute=async()=>{const settings=await ctx.settings();if(settings.paused||settings.killSwitch)throw new FactoryError("STUDIO_PAUSED","RETRYABLE","Paused before English CPU alignment");return runProcess(python,[script,requestFile],{timeoutMs:900000,env:{PYTHONDONTWRITEBYTECODE:"1",PYTHONUTF8:"1"}});};
 const result=await withLock(environmentLock(python),()=>withLock(modelStoreLock(config.alignmentModel),execute,{waitMs:7200000,ttlMs:60000,purpose:"Pin English alignment checkpoint throughout CPU inference"}),{waitMs:7200000,ttlMs:60000,purpose:"Keep compatible ASR runtime unchanged during alignment"});
 await fs.writeFile(`${requestFile}.log`,result.stderr,"utf8");let data:any;try{data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)??"{}");}catch{throw new Error("English alignment did not return valid JSON");}
 if(result.code!==0||data.error)throw new Error(data.error||result.stderr.slice(-1600)||"English CPU alignment failed");
 if(data.engine!=="wav2vec2-ctc-en"||data.device!=="cpu"||data.language!==language||!Array.isArray(data.results)||data.results.length!==measured.length)throw new Error("English alignment response does not match the request");
 // Defend against concurrent audio changes even after the offline process finished.
 for(const line of measured)if(createHash("sha256").update(await fs.readFile(line.file)).digest("hex")!==line.audioSha256)throw new Error("QUALITY_LOCK: narration audio changed during alignment");
 return{lines:measured,evidence:data};
}
