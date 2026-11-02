import * as fs from "node:fs/promises";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {z} from "zod";
import {writeJsonAtomic} from "@ttm/storage";
export const dynamic="force-dynamic";
const Preferences=z.object({closeAction:z.enum(["hide","quit"]).default("hide"),autostart:z.boolean().default(false)});
const run=promisify(execFile);
async function state(){const root=process.env.ACS_DESKTOP_CONFIG,exe=process.env.ACS_DESKTOP_EXE;if(!root||!exe)return {available:false,preferences:Preferences.parse({})};const preferences=await fs.readFile(path.join(root,"preferences.json"),"utf8").then(s=>Preferences.parse(JSON.parse(s)),()=>Preferences.parse({}));return {available:true,preferences,root,exe};}
export async function GET(){const {available,preferences}=await state();return Response.json({available,preferences});}
export async function POST(request:Request){
 if(request.headers.get("origin")!==`http://${request.headers.get("host")}`)return Response.json({error:"Invalid origin"},{status:403});
 try{const current=await state();if(!current.available||!current.root||!current.exe)throw new Error("Open the Windows desktop application to change these settings");const value=Preferences.parse(await request.json());
  if(value.autostart!==current.preferences.autostart){
   const command=value.autostart?"New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Force | Out-Null; New-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'AutonomousCreativeStudio' -Value $env:ACS_AUTOSTART_VALUE -PropertyType String -Force | Out-Null":"Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'AutonomousCreativeStudio' -ErrorAction SilentlyContinue";
   await run("powershell.exe",["-NoProfile","-NonInteractive","-Command","$ErrorActionPreference='Stop'; "+command],{windowsHide:true,timeout:15000,env:{...process.env,ACS_AUTOSTART_VALUE:`\"${current.exe}\"`}});
  }
  await writeJsonAtomic(path.join(current.root,"preferences.json"),value);return Response.json({available:true,preferences:value});
 }catch(e:any){return Response.json({error:e.message},{status:400});}
}
