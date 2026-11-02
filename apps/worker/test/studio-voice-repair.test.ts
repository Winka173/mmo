import {describe,it,expect,vi} from "vitest";
import * as fs from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import sharp from "sharp";
import {StudioStore} from "@ttm/automation";
import {buildContext} from "../src/context.js";
import {executeStudio} from "../src/studio.js";
import {tmpDir} from "../../../packages/storage/test/helpers.js";
const engine=vi.hoisted(()=>({calls:[] as any[],tone:"",firstAsr:true}));
vi.mock("../src/local-engine.js",()=>({invokeLocalEngine:async(_ctx:any,_config:any,request:any)=>{
 engine.calls.push(request);
 if(request.op.endsWith("environment"))return {fingerprint:"contract-runtime-not-a-real-model"};
 if(request.op==="tts"){await fs.copyFile(engine.tone,request.output);return {engine:"contract-wave-not-real-speech",language:request.language};}
 if(request.op==="asr"){const first=engine.firstAsr;engine.firstAsr=false;return {results:request.audio.map((file:string,i:number)=>({file,text:first&&i===1?"The second line must remain untouched.":"A C S is the fixture name.",language:first&&i===0?"Chinese":"English"}))};}
 throw new Error("Unexpected engine operation");
}}));
const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
describe("Targeted voice retry and pronunciation dependency contract (mock AI, actual FFmpeg)",()=>{
 it("retries only the flagged line with identical effective words, preserves evidence and leaves the other audio untouched",async()=>{
  engine.calls=[];engine.firstAsr=true;const ctx=await buildContext({dataDir:await tmpDir("acs-voice-repair-contract-")}),studio=new StudioStore(ctx.store),source=ctx.store.p("owned-fixture");await fs.mkdir(source,{recursive:true});await sharp({create:{width:640,height:360,channels:3,background:"#46356d"}}).png().toFile(source+"/owned.png");
  const pcm=Buffer.alloc(44+24000*2);pcm.write("RIFF");pcm.writeUInt32LE(pcm.length-8,4);pcm.write("WAVEfmt ",8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(24000,24);pcm.writeUInt32LE(48000,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write("data",36);pcm.writeUInt32LE(48000,40);for(let i=0;i<24000;i++)pcm.writeInt16LE(Math.round(1800*Math.sin(2*Math.PI*220*i/24000)),44+i*2);engine.tone=ctx.store.p("owned-tone.wav");await fs.writeFile(engine.tone,pcm);
  const root=process.cwd();await studio.saveConfig({ffmpeg:root+"/.local/tools/ffmpeg.exe",ffprobe:root+"/.local/tools/ffprobe.exe",asrModel:source,pythonAsr:"mock-not-invoked"});
  const now=new Date().toISOString(),a=await studio.saveAutopilot({id:randomUUID(),name:"Mock AI repair contract; not a voice benchmark",sourceFolder:source,scriptText:"ACS is the fixture name.\n\nThe second line must remain untouched.",pronunciation:[{term:"ACS",spoken:"A C S",language:"en-US"}],rights:"AUTHORIZED_REUSE",rightsEvidence:"Owned generated image and sine tone for contract testing only",createdAt:now,updatedAt:now}),{id}=await studio.enqueue(a,"en-US",randomUUID());
  await executeStudio(ctx,id);const run=(await studio.run(id))!,dir=ctx.store.p("studio","artifacts",id),repair=JSON.parse(await fs.readFile(dir+"/voice-repair.json","utf8")),review=JSON.parse(await fs.readFile(dir+"/voice-review.json","utf8"));
  expect(run.state).toBe("ready");expect(engine.calls.filter(c=>c.op==="tts").map(c=>c.text)).toEqual(["A C S is the fixture name.","The second line must remain untouched.","A C S is the fixture name."]);expect(repair.events).toHaveLength(1);expect(repair.events[0].index).toBe(0);expect(review.checks.every((c:any)=>c.status==="pass")).toBe(true);expect(hash(await fs.readFile(dir+"/voice-1.wav"))).toBe(hash(pcm));expect(await fs.readFile(dir+"/repairs/voice-0-attempt-0.wav")).toEqual(pcm);expect(run.shots[0].text).toBe("ACS is the fixture name.");expect((await fs.readFile(dir+"/captions.srt","utf8"))).toContain("ACS is the fixture name.");expect((await studio.timeline(id))?.clips.filter(c=>c.track==="dialogue")).toHaveLength(2);
  // A policy upgrade may reuse immutable audio/transcriptions, never an old PASS decision.
  await fs.writeFile(dir+"/voice-review.json",JSON.stringify({...review,key:review.inputKey,policyVersion:1}));await studio.saveRun({...run,state:"failed"});
  const before=engine.calls.filter(c=>["tts","asr"].includes(c.op)).length;await executeStudio(ctx,id);
  const rescored=JSON.parse(await fs.readFile(dir+"/voice-review.json","utf8"));expect(rescored.policyVersion).toBe(2);expect(rescored.rescoredWithoutInference).toBe(true);expect(engine.calls.filter(c=>["tts","asr"].includes(c.op))).toHaveLength(before);
 },60000);
});
