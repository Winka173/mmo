import {describe,it,expect,beforeAll,afterAll} from "vitest";
import {createServer,type Server} from "node:http";
import * as fs from "node:fs/promises";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {StudioStore} from "@ttm/automation";
import {writeJsonAtomic} from "@ttm/storage";
import {buildContext} from "../src/context.js";
import {BrowserMuseGenerator,MuseBlocked,MuseSettings} from "../src/muse.js";
import {executeMuseRun,setMuseGeneratorFactory} from "../src/muse-run.js";
import {tmpDir} from "../../../packages/storage/test/helpers.js";

/** A local fake of the meta.ai page (never the real site). Variants: ok, captcha, layout-changed. */
let server:Server,base="",mp4:Buffer;
const page=(variant:string)=>variant==="captcha"?`<html><body><div data-testid="captcha">Verify you are human</div></body></html>`:variant==="layout"?`<html><body><div>New design</div></body></html>`:
 `<html><body><textarea data-testid="composer-input"></textarea><button data-testid="composer-send" onclick="setTimeout(()=>{document.body.insertAdjacentHTML('beforeend','<div data-testid=generated-video><video src=/fixture.mp4></video></div><a download=muse.mp4 href=/fixture.mp4>Download</a>')},800)">Send</button></body></html>`;
beforeAll(async()=>{
 const dir=await tmpDir("acs-muse-fixture-"),file=path.join(dir,"fixture.mp4");
 const r=spawnSync("ffmpeg",["-hide_banner","-loglevel","error","-y","-f","lavfi","-i","testsrc2=size=720x1280:rate=30:duration=3","-f","lavfi","-i","sine=frequency=440:duration=3","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac","-shortest",file]);if(r.status!==0)throw new Error("ffmpeg needed for the fixture");
 mp4=await fs.readFile(file);
 server=createServer((req,res)=>{if(req.url==="/fixture.mp4"){res.writeHead(200,{"content-type":"video/mp4"});res.end(mp4);return;}res.writeHead(200,{"content-type":"text/html"});res.end(page(new URL(req.url!,"http://x").searchParams.get("v")??"ok"));});
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r()));base=`http://127.0.0.1:${(server.address() as any).port}/`;
},120000);
afterAll(()=>new Promise<void>(r=>server.close(()=>r())));
const settings=(v="ok",extra={})=>MuseSettings.parse({enabled:true,termsAcknowledgedAt:new Date().toISOString(),minDelayMs:200,maxDelayMs:300,timeoutMs:30000,baseUrl:`${base}?v=${v}`,...extra});
async function generator(v:string,extra={}){const ctx=await buildContext({dataDir:await tmpDir("acs-muse-")});return {ctx,g:new BrowserMuseGenerator(ctx.store,settings(v,extra),{headless:true,profileDir:await tmpDir("acs-muse-profile-")})};}

describe("Meta Muse browser driver against a local fake page (no real login, generation or posting)",()=>{
 it("submits the prompt with human-like pacing and downloads the finished MP4",async()=>{
  const {ctx,g}=await generator("ok",{dailyCap:1}),out=path.join(await tmpDir("acs-muse-out-"),"m.mp4");
  const r=await g.generate("A calm vertical shot of a tower defense map at dusk, narrator says: Lane Keeper.",out);
  expect(r.bytes).toBe(mp4.length);expect((await fs.readFile(out)).equals(mp4)).toBe(true);
  await expect(g.generate("second prompt over the daily cap of one, should stop",out+"2")).rejects.toThrow();void ctx;
 },120000);
 it("stops on a captcha and flags a changed layout as 'driver needs update'",async()=>{
  const c=await generator("captcha");await expect(c.g.generate("prompt that must not be submitted anywhere",path.join(await tmpDir("m"),"x.mp4"))).rejects.toMatchObject({reason:"captcha",code:"MUSE_NEEDS_USER"});
  const l=await generator("layout");await expect(l.g.generate("prompt that must not be submitted anywhere",path.join(await tmpDir("m"),"x.mp4"))).rejects.toMatchObject({reason:"layout",code:"MUSE_DRIVER_NEEDS_UPDATE"});
 },120000);
 it("respects the editable daily cap and refuses before the terms notice is acknowledged",async()=>{
  const capped=await generator("ok",{dailyCap:0});await expect(capped.g.generate("prompt over a zero daily cap must stop",path.join(await tmpDir("m"),"x.mp4"))).rejects.toMatchObject({reason:"limit"});
  const ctx=await buildContext({dataDir:await tmpDir("acs-muse-terms-")}),g=new BrowserMuseGenerator(ctx.store,MuseSettings.parse({enabled:true}),{headless:true});
  await expect(g.generate("prompt before acknowledgement must stop",path.join(await tmpDir("m"),"x.mp4"))).rejects.toBeInstanceOf(MuseBlocked);
 },60000);
});

describe("Muse run: unedited artifact with provenance, technical QA, then the normal review flow",()=>{
 async function museRun(){
  const ctx=await buildContext({dataDir:await tmpDir("acs-muse-run-")}),studio=new StudioStore(ctx.store),now=new Date().toISOString();
  const a=await studio.saveAutopilot({id:randomUUID(),name:"Muse fixture",brief:"Fixture brief",generation:"muse",musePrompts:["A vertical fixture clip with a short spoken line, fixture only."],rights:"AUTHORIZED_REUSE",rightsEvidence:"Synthetic fixture, owner test",createdAt:now,updatedAt:now});
  const {id}=await studio.enqueue(a,"vi-VN",randomUUID()),run=(await studio.run(id))!,dir=ctx.store.p("studio","artifacts",id);await fs.mkdir(dir,{recursive:true});
  const stages:string[]=[];return {ctx,studio,run,dir,stage:async(s:string,state:string)=>{stages.push(`${s}:${state}`);},stages};
 }
 it("stores the Muse MP4 unedited (read-only original + final copy), provenance with UNVERIFIED limits, QA passes",async()=>{
  const f=await museRun();setMuseGeneratorFactory(async()=>({id:"fake",status:async()=>"ready",generate:async(_p,out)=>{await fs.writeFile(out,mp4);return {file:out,sha256:"f".repeat(64),bytes:mp4.length,startedAt:"t0",finishedAt:"t1",pageUrl:"fake"};}}));
  const done=await executeMuseRun(f.ctx,f.run,f.dir,f.stage);expect(done.state).toBe("ready");
  const prov=JSON.parse(await fs.readFile(path.join(f.dir,"muse.json"),"utf8"));expect(prov).toMatchObject({aiGenerated:true,edited:false,limits:{duration:"UNVERIFIED",aspect:"UNVERIFIED"}});
  expect((await fs.readFile(path.join(f.dir,"final.mp4"))).equals(mp4)).toBe(true);expect(JSON.parse(await fs.readFile(path.join(f.dir,"qa.json"),"utf8"))).toMatchObject({technical:true,aiGenerated:true});
  expect(f.stages).toContain("render:skipped");
 },120000);
 it("a captcha pauses production (Needs user) and keeps nothing half-made",async()=>{
  const f=await museRun();setMuseGeneratorFactory(async()=>({id:"fake",status:async()=>"blocked",generate:async()=>{throw new MuseBlocked("captcha","fake captcha");}}));
  await expect(executeMuseRun(f.ctx,f.run,f.dir,f.stage)).rejects.toMatchObject({code:"MUSE_NEEDS_USER"});expect((await f.ctx.settings()).paused).toBe(true);
  expect(await fs.stat(path.join(f.dir,"final.mp4")).catch(()=>null)).toBeNull();void writeJsonAtomic;
 });
});
