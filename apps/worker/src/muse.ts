import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {createHash} from "node:crypto";
import {z} from "zod";
import {FactoryError} from "@ttm/core";
import {readJson,writeJsonAtomic,type DataStore} from "@ttm/storage";

/**
 * Meta Muse Video source. Meta has no public developer API for Muse (checked 2026-11), so the owner authorized
 * browser automation of meta.ai with their own account: one persistent profile, manual login once, human-like pacing,
 * an editable daily cap. On captcha / checkpoint / login wall / limit message the job stops and waits for the owner.
 * No captcha solving, no stealth plugins, no proxies, no account rotation. A future official API replaces only the
 * MuseGenerator implementation. Real duration/aspect limits are UNVERIFIED until a real run.
 */
export type MuseResult={file:string;sha256:string;bytes:number;startedAt:string;finishedAt:string;pageUrl:string};
export interface MuseGenerator{readonly id:string;generate(prompt:string,outFile:string):Promise<MuseResult>;status():Promise<"ready"|"needs_login"|"blocked"|"driver_needs_update"|"not_configured">;}
export class MuseBlocked extends FactoryError{constructor(readonly reason:"captcha"|"checkpoint"|"login"|"limit"|"layout",detail:string){super(reason==="layout"?"MUSE_DRIVER_NEEDS_UPDATE":"MUSE_NEEDS_USER","HUMAN_REQUIRED",detail);}}

/** Every selector lives here. A missing one means the page layout changed: the job is flagged "driver needs update". */
export const MUSE_SELECTORS={
 composer:'textarea[aria-label*="Ask" i], textarea[placeholder*="Ask" i], [data-testid="composer-input"]',
 submit:'[aria-label="Send" i], [data-testid="composer-send"]',
 resultVideo:'video[src], [data-testid="generated-video"] video',
 download:'a[download], [aria-label*="Download" i]',
 captcha:'iframe[src*="captcha" i], [data-testid="captcha"]',
 checkpoint:'[data-testid="checkpoint"], form[action*="checkpoint" i]',
 loginWall:'[data-testid="login-wall"], a[href*="login" i][role="button"], form[action*="login" i]',
 limit:'[data-testid="rate-limit"], [role="alert"]:has-text("limit"), [role="alert"]:has-text("giới hạn")',
} as const;
export const MuseSettings=z.object({enabled:z.boolean().default(false),termsAcknowledgedAt:z.string().nullable().default(null),dailyCap:z.number().int().min(0).max(50).default(3),minDelayMs:z.number().int().min(200).max(60000).default(1500),maxDelayMs:z.number().int().min(300).max(120000).default(4000),timeoutMs:z.number().int().min(10000).max(3600000).default(900000),baseUrl:z.string().url().default("https://www.meta.ai/")});
export type MuseSettings=z.infer<typeof MuseSettings>;
export const museSettingsFile=(store:DataStore)=>store.p("config","muse.json");
export const readMuseSettings=async(store:DataStore)=>MuseSettings.parse((await readJson(museSettingsFile(store),z.any()))??{});
export const museProfileDir=()=>path.join(process.env.ACS_DESKTOP_CONFIG??path.join(process.env.LOCALAPPDATA??os.tmpdir(),"AutonomousCreativeStudio"),"muse-profile");
const usageFile=(store:DataStore)=>store.p("studio","muse-usage.json");
async function takeDailySlot(store:DataStore,cap:number){const day=new Date().toISOString().slice(0,10),u=(await readJson(usageFile(store),z.record(z.number())))??{};if((u[day]??0)>=cap)throw new MuseBlocked("limit",`Daily Muse cap ${cap} reached; continue tomorrow or raise the cap`);u[day]=(u[day]??0)+1;await writeJsonAtomic(usageFile(store),u);}

/** Playwright driver on the owner's persistent profile (installed Microsoft Edge). Tests point baseUrl at a local fake page. */
export class BrowserMuseGenerator implements MuseGenerator{
 readonly id="meta-ai-browser";
 constructor(private readonly store:DataStore,private readonly settings:MuseSettings,private readonly opts:{headless?:boolean;profileDir?:string;launch?:any}={}){}
 private async open(){const {chromium}=await import("playwright-core");const launch=this.opts.launch??((dir:string,o:any)=>chromium.launchPersistentContext(dir,{channel:"msedge",...o}));
  // Plain browser: no stealth plugins, no proxy, no fingerprint changes.
  return launch(this.opts.profileDir??museProfileDir(),{headless:this.opts.headless??false,acceptDownloads:true,viewport:{width:1280,height:900}});}
 private pause(){const s=this.settings;return new Promise(r=>setTimeout(r,s.minDelayMs+Math.random()*(s.maxDelayMs-s.minDelayMs)));}
 private async blocked(page:any){for(const [reason,sel] of [["captcha",MUSE_SELECTORS.captcha],["checkpoint",MUSE_SELECTORS.checkpoint],["login",MUSE_SELECTORS.loginWall],["limit",MUSE_SELECTORS.limit]] as const)if(await page.locator(sel).first().isVisible().catch(()=>false))return reason;return null;}
 async status(){if(!this.settings.enabled||!this.settings.termsAcknowledgedAt)return "not_configured" as const;const ctx=await this.open();try{const page=ctx.pages()[0]??await ctx.newPage();await page.goto(this.settings.baseUrl,{waitUntil:"domcontentloaded",timeout:60000});const b=await this.blocked(page);if(b==="login")return "needs_login" as const;if(b)return "blocked" as const;return (await page.locator(MUSE_SELECTORS.composer).count())?"ready" as const:"driver_needs_update" as const;}finally{await ctx.close();}}
 async generate(prompt:string,outFile:string):Promise<MuseResult>{
  if(!this.settings.enabled||!this.settings.termsAcknowledgedAt)throw new MuseBlocked("login","Muse is not enabled, or the terms notice was not acknowledged, in Settings › Accounts & Keys");
  await takeDailySlot(this.store,this.settings.dailyCap);
  const ctx=await this.open(),startedAt=new Date().toISOString();
  try{
   const page=ctx.pages()[0]??await ctx.newPage();await page.goto(this.settings.baseUrl,{waitUntil:"domcontentloaded",timeout:60000});await this.pause();
   const b=await this.blocked(page);if(b)throw new MuseBlocked(b,`meta.ai shows a ${b} screen; the owner must handle it in the login window`);
   const composer=page.locator(MUSE_SELECTORS.composer).first();if(!await composer.count())throw new MuseBlocked("layout","Composer not found: the meta.ai layout changed, the Muse driver needs an update");
   await composer.click();await composer.pressSequentially(prompt,{delay:35+Math.random()*40});await this.pause();
   const submit=page.locator(MUSE_SELECTORS.submit).first();if(!await submit.count())throw new MuseBlocked("layout","Send button not found: the Muse driver needs an update");await submit.click();
   const deadline=Date.now()+this.settings.timeoutMs;
   for(;;){const blockedNow=await this.blocked(page);if(blockedNow)throw new MuseBlocked(blockedNow,`meta.ai showed a ${blockedNow} screen while generating`);
    if(await page.locator(MUSE_SELECTORS.resultVideo).count())break;if(Date.now()>deadline)throw new FactoryError("MUSE_TIMEOUT","RETRYABLE","Muse did not finish in time");await page.waitForTimeout(3000);}
   await this.pause();
   const link=page.locator(MUSE_SELECTORS.download).first();let bytes:Buffer;
   if(await link.count()){const [dl]=await Promise.all([page.waitForEvent("download",{timeout:120000}),link.click()]);await dl.saveAs(outFile);bytes=await fs.readFile(outFile);}
   else{const src=await page.locator(MUSE_SELECTORS.resultVideo).first().getAttribute("src");if(!src)throw new MuseBlocked("layout","Video found without a source: the Muse driver needs an update");const r=await page.request.get(new URL(src,page.url()).toString());bytes=Buffer.from(await r.body());await fs.writeFile(outFile,bytes);}
   if(bytes.length<1024||bytes.subarray(4,8).toString("latin1")!=="ftyp")throw new FactoryError("MUSE_BAD_FILE","HUMAN_REQUIRED","The downloaded file is not an MP4");
   return {file:outFile,sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length,startedAt,finishedAt:new Date().toISOString(),pageUrl:page.url()};
  }finally{await ctx.close().catch(()=>{});}
 }
}
/** Opens the persistent profile visibly so the owner can log in by hand. ACS never types credentials. */
export async function openMuseLoginWindow(settings:MuseSettings){const {chromium}=await import("playwright-core");const ctx=await chromium.launchPersistentContext(museProfileDir(),{channel:"msedge",headless:false});const page=ctx.pages()[0]??await ctx.newPage();await page.goto(settings.baseUrl);return ctx;}
