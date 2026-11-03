import path from "node:path";
import os from "node:os";
import {z} from "zod";
import {readJson,writeJsonAtomic} from "@ttm/storage";
import {getStore} from "../../../lib/data";
export const dynamic="force-dynamic";
const Settings=z.object({enabled:z.boolean().default(false),termsAcknowledgedAt:z.string().nullable().default(null),dailyCap:z.number().int().min(0).max(50).default(3),minDelayMs:z.number().int().min(200).max(60000).default(1500),maxDelayMs:z.number().int().min(300).max(120000).default(4000),timeoutMs:z.number().int().min(10000).max(3600000).default(900000),baseUrl:z.string().url().default("https://www.meta.ai/"),loginWindowOpenedAt:z.string().nullable().default(null),lastStatus:z.string().nullable().default(null)});
const profile=()=>path.join(process.env.ACS_DESKTOP_CONFIG??path.join(process.env.LOCALAPPDATA??os.tmpdir(),"AutonomousCreativeStudio"),"muse-profile");
let loginWindow:any=null;
/** Meta AI / Muse entry of Accounts & Keys. ACS never types or stores the Meta password; the owner logs in by hand in the window. */
export async function GET(){const store=await getStore(),s=Settings.parse((await readJson(store.p("config","muse.json"),z.any()))??{}),usage=(await readJson(store.p("studio","muse-usage.json"),z.record(z.number())))??{};
 const status=!s.termsAcknowledgedAt?"terms":!s.enabled?"disabled":s.lastStatus??"needs_login";
 return Response.json({settings:s,status,usedToday:usage[new Date().toISOString().slice(0,10)]??0,profileDir:profile(),loginWindowOpen:!!loginWindow,limits:{duration:"UNVERIFIED",aspect:"UNVERIFIED"},api:"No public Muse developer API (checked 2026-11); browser automation authorized by the owner"},{headers:{"Cache-Control":"no-store"}});}
const Body=z.discriminatedUnion("action",[z.object({action:z.literal("save"),enabled:z.boolean(),acknowledge:z.boolean(),dailyCap:z.number().int().min(0).max(50),minDelayMs:z.number().int().min(200).max(60000),maxDelayMs:z.number().int().min(300).max(120000)}),z.object({action:z.literal("open-login")}),z.object({action:z.literal("logged-in")})]);
export async function POST(request:Request){
 try{const b=Body.parse(await request.json()),store=await getStore(),file=store.p("config","muse.json"),s=Settings.parse((await readJson(file,z.any()))??{});
  if(b.action==="save"){if(b.maxDelayMs<b.minDelayMs)throw new Error("Maximum delay must be at least the minimum");const next={...s,enabled:b.enabled&&(b.acknowledge||!!s.termsAcknowledgedAt),termsAcknowledgedAt:s.termsAcknowledgedAt??(b.acknowledge?new Date().toISOString():null),dailyCap:b.dailyCap,minDelayMs:b.minDelayMs,maxDelayMs:b.maxDelayMs};await writeJsonAtomic(file,next);await store.audit({actor:"studio-ui",action:"muse.settings",subject:"muse",detail:{enabled:next.enabled,dailyCap:next.dailyCap,termsAcknowledged:!!next.termsAcknowledgedAt}});return Response.json(next);}
  if(!s.termsAcknowledgedAt||!s.enabled)throw new Error("Acknowledge the notice and enable Muse first");
  if(b.action==="logged-in"){await writeJsonAtomic(file,{...s,lastStatus:"owner_reported_logged_in"});return Response.json({ok:true});}
  if(loginWindow)return Response.json({ok:true,already:true});
  const {chromium}=await import("playwright-core");
  loginWindow=await chromium.launchPersistentContext(profile(),{channel:"msedge",headless:false});loginWindow.on("close",()=>{loginWindow=null;});
  const page=loginWindow.pages()[0]??await loginWindow.newPage();await page.goto(s.baseUrl).catch(()=>{});
  await writeJsonAtomic(file,{...s,loginWindowOpenedAt:new Date().toISOString()});return Response.json({ok:true});
 }catch(e){return Response.json({error:e instanceof z.ZodError?"Invalid request":e instanceof Error?e.message.slice(0,300):"Failed"},{status:400});}
}
