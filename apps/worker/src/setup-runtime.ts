import * as fs from "node:fs/promises";
import {createReadStream} from "node:fs";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {runProcess} from "@ttm/media";
import {withLock,writeJsonAtomic} from "@ttm/storage";
import {modelStoreLock} from "@ttm/automation";

export const OLLAMA_RUNTIME={version:"0.40.8",url:"https://github.com/ollama/ollama/releases/download/v0.40.8/ollama-windows-amd64.zip",bytes:1582537058,sha256:"04d1d43ac62c2deb0393307bb49fed7caf6b192de41bdd497aaa9488089d5552",source:"https://github.com/ollama/ollama/releases/tag/v0.40.8"} as const;
type Artifact={url:string;bytes:number;sha256:string};
type Progress=(value:Record<string,unknown>)=>Promise<void>;
async function sha256(file:string){const hash=createHash("sha256");for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest("hex");}
async function ordinaryFile(file:string){const info=await fs.lstat(file).catch(error=>{if(error.code==="ENOENT")return null;throw error;});if(info&&(!info.isFile()||info.isSymbolicLink()))throw new Error("Runtime download target must be an ordinary owned file");return info;}
/** A pinned download can be resumed after interruption. A server ignoring Range restarts safely. */
export async function downloadPinnedRuntime(artifact:Artifact,destination:string,progress:Progress,request:typeof fetch=fetch){
 const url=new URL(artifact.url);if(url.protocol!=="https:"||url.hostname!=="github.com"||!url.pathname.startsWith("/ollama/ollama/releases/download/")||!Number.isSafeInteger(artifact.bytes)||artifact.bytes<1||!/^[a-f0-9]{64}$/.test(artifact.sha256))throw new Error("Invalid pinned runtime source");
 const temporary=destination+".acs-partial",existing=await ordinaryFile(destination);await ordinaryFile(temporary);
 if(existing){if(existing.size!==artifact.bytes||await sha256(destination)!==artifact.sha256)throw new Error("Existing runtime archive differs from the official pinned checksum; move the damaged archive aside and retry");return {file:destination,resumedBytes:artifact.bytes,sha256:artifact.sha256};}
 let resumedBytes=0;
 for(let attempt=0;attempt<3;attempt++){
  let offset=(await ordinaryFile(temporary))?.size??0;if(offset>artifact.bytes)throw new Error("Runtime partial file exceeds the pinned archive size");if(attempt===0)resumedBytes=offset;
  if(offset===artifact.bytes)break;
  try{
   const response=await request(artifact.url,{headers:offset?{Range:`bytes=${offset}-`}:{},redirect:"follow",signal:AbortSignal.timeout(15*60*1000)});
   if(response.url){const final=new URL(response.url);if(final.protocol!=="https:"||!["github.com","release-assets.githubusercontent.com","objects.githubusercontent.com"].includes(final.hostname))throw new Error("Unexpected runtime download redirect");}
   if(!response.body)throw new Error("Runtime download returned no body");
   if(response.status===206){const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range")??"");if(!range||Number(range[1])!==offset||Number(range[2])!==artifact.bytes-1||Number(range[3])!==artifact.bytes)throw new Error("Runtime server returned an unexpected byte range");}
   else if(response.status===200){offset=0;}
   else throw new Error(`Runtime download HTTP ${response.status}`);
   const length=response.headers.get("content-length");if(length!==null&&Number(length)!==artifact.bytes-offset)throw new Error("Runtime response length differs from the pinned size");
   const handle=await fs.open(temporary,offset?"r+":"w");let lastNotice=0;
   try{
    for await(const item of response.body as any){const bytes=Buffer.from(item);if(offset+bytes.length>artifact.bytes)throw new Error("Runtime response exceeds pinned size");let written=0;while(written<bytes.length){const result=await handle.write(bytes,written,bytes.length-written,offset+written);if(!result.bytesWritten)throw new Error("Runtime write made no progress");written+=result.bytesWritten;}offset+=bytes.length;
     if(Date.now()-lastNotice>1500||offset===artifact.bytes){lastNotice=Date.now();await progress({status:"Downloading pinned official Ollama runtime",completed:offset,total:artifact.bytes,resumedBytes,attempt:attempt+1,sha256:artifact.sha256,source:artifact.url});}
    }
    await handle.sync();
   }finally{await handle.close();}
   if(offset!==artifact.bytes)throw new Error("Runtime download ended before the pinned byte count");break;
  }catch(error){if(attempt===2)throw error;await progress({status:"Runtime download interrupted; resuming verified destination",attempt:attempt+1,error:String(error),partialFile:temporary});}
 }
 if((await ordinaryFile(temporary))?.size!==artifact.bytes||await sha256(temporary)!==artifact.sha256)throw new Error("Official Ollama runtime SHA-256 mismatch; archive was not extracted or executed. Move the damaged .acs-partial file aside and retry");
 await fs.rename(temporary,destination);return {file:destination,resumedBytes,sha256:artifact.sha256};
}

export async function extractRuntimeArchive(archive:string,destination:string){
 const engineDir=path.dirname(process.env.ACS_ENGINE_RUNNER??path.resolve("engines/runner.py"));
 const result=await runProcess("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",path.join(engineDir,"extract-runtime.ps1"),"-Archive",archive,"-Destination",destination],{timeoutMs:10*60*1000});
 if(result.code!==0)throw new Error(`Runtime extraction failed: ${result.stderr.slice(-1800)}`);
}

/** Only creates a versioned private runtime; it never replaces a configured executable or changes system installs. */
export async function installPrivateOllama(base:string,progress:Progress){
 if(process.platform!=="win32"||process.arch!=="x64")throw new Error("Automatic Ollama runtime setup currently supports Windows x64 only; configure a local runtime explicitly on this platform");
 const folder=path.join(base,"tools",`ollama-${OLLAMA_RUNTIME.version}`),binary=path.join(folder,"ollama.exe"),marker=path.join(folder,"acs-runtime.json");
 return withLock(modelStoreLock(folder),async()=>{
  const present=await fs.stat(folder).catch(()=>null);
  if(present){
   const previous=await fs.readFile(marker,"utf8").then(JSON.parse,()=>null);
   if(previous?.archiveSha256!==OLLAMA_RUNTIME.sha256||!Array.isArray(previous.files))throw new Error("The private versioned Ollama folder already exists without a matching ACS manifest; choose a fresh ACS setup folder rather than replacing it");
   for(const entry of previous.files){const file=path.join(folder,entry.path);if(!/^[a-f0-9]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||path.isAbsolute(entry.path)||entry.path.split(/[\\/]/).includes("..")||(await ordinaryFile(file))?.size!==entry.bytes||await sha256(file)!==entry.sha256)throw new Error("Installed private Ollama runtime changed; choose a fresh setup folder or restore the verified files");}
   return {binary,manifest:marker,reused:true};
  }
  const cache=path.join(base,"downloads");await fs.mkdir(cache,{recursive:true});const archive=path.join(cache,`ollama-${OLLAMA_RUNTIME.version}-windows-amd64.zip`);
  const download=await downloadPinnedRuntime(OLLAMA_RUNTIME,archive,progress),staging=path.join(base,"tools",`.ollama-${OLLAMA_RUNTIME.version}-${randomUUID()}.staging`);
  await progress({status:"SHA-256 verified; extracting private Ollama runtime",archiveSha256:download.sha256,source:OLLAMA_RUNTIME.source});
  await extractRuntimeArchive(archive,staging);
  if(!(await fs.stat(path.join(staging,"ollama.exe")).catch(()=>null))?.isFile()||!(await fs.stat(path.join(staging,"lib","ollama")).catch(()=>null))?.isDirectory())throw new Error("Pinned runtime archive lacks its executable or companion lib directory");
  const files:{path:string;bytes:number;sha256:string}[]=[];
  async function inventory(directory:string){for(const item of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isSymbolicLink())throw new Error("Runtime extraction contains a redirected path");if(item.isDirectory())await inventory(file);else if(item.isFile())files.push({path:path.relative(staging,file).replaceAll("\\","/"),bytes:(await fs.stat(file)).size,sha256:await sha256(file)});else throw new Error("Unexpected runtime file type");}}
  await inventory(staging);
  const manifest={owner:"AUTONOMOUS CREATIVE STUDIO",version:OLLAMA_RUNTIME.version,source:OLLAMA_RUNTIME.source,archiveSha256:OLLAMA_RUNTIME.sha256,archiveBytes:OLLAMA_RUNTIME.bytes,downloadUrl:OLLAMA_RUNTIME.url,installedAt:new Date().toISOString(),inference:"NOT_VERIFIED",files};
  await writeJsonAtomic(path.join(staging,"acs-runtime.json"),manifest);await fs.rename(staging,folder);
  await progress({status:"Private Ollama runtime installed; checkpoint download follows",runtime:binary,files:files.length,archiveSha256:OLLAMA_RUNTIME.sha256});
  return {binary,manifest:marker,reused:false};
 },{waitMs:7200000,ttlMs:60000,purpose:"ACS private pinned runtime installation"});
}
