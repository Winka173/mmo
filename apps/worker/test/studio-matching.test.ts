import {describe,it,expect,vi} from "vitest";
import * as fs from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import {StudioRun,StudioConfig,Autopilot,hash,embeddingTextHash,StudioMediaCatalog,StudioStore} from "@ttm/automation";
import {DataStore} from "@ttm/storage";
import {runProcess} from "@ttm/media";
import {tmpDir} from "../../../packages/storage/test/helpers.js";
const state=vi.hoisted(()=>({calls:0,corrupt:false}));
vi.mock("../src/local-engine.js",()=>({invokeLocalEngine:async(_ctx:any,_config:any,request:any)=>{state.calls++;return{fingerprint:"c".repeat(64),device:"cpu",engine:"CONTROLLED_EMBEDDING_TEST_DOUBLE_NOT_INFERENCE",documents:request.texts.map((row:any)=>{const vector=Array(1024).fill(0);vector[/dragon|boss|rồng/i.test(row.text)?0:1]=1;return{id:row.id,textSha256:state.corrupt?"0".repeat(64):embeddingTextHash(row.text),vector};})};}}));
import {matchStudioShots,chooseStudioMedia,metadataSimilarity,StudioMediaAnnotations} from "../src/studio-matching.js";
async function fixture(embedding=false){
 const root=await tmpDir("acs-matching-"),folder=path.join(root,"input"),dir=path.join(root,"artifacts");await fs.mkdir(folder);await fs.mkdir(dir);
 const sources=[];
 for(const [index,color]of ["red","blue"].entries()){const file=path.join(dir,`source-${index}.png`);await sharp({create:{width:40,height:40,channels:3,background:color}}).png().toFile(file);const bytes=await fs.readFile(file);sources.push({file,sha256:createHash("sha256").update(bytes).digest("hex"),size:bytes.length});}
 const now=new Date().toISOString(),snapshot=Autopilot.parse({id:randomUUID(),family:"game",name:"Owned color cards, not gameplay",sourceFolder:folder,createdAt:now,updatedAt:now});
 const config=StudioConfig.parse(embedding?{pythonEmbedding:"controlled-test-python",embeddingModel:"controlled-test-checkpoint",embeddingDevice:"cpu"}:{});
 const run=StudioRun.parse({id:randomUUID(),autopilotId:snapshot.id,title:"Matching protocol",language:"en-US",snapshot,config,snapshotHash:hash(snapshot),stages:[],sources,shots:[{text:"Harvest the farm wheat and crops"},{text:"Fight the dragon boss"}],createdAt:now,updatedAt:now});
 const manifest={version:1,assets:[{file:"boss.png",sha256:sources[0].sha256,description:"Fight the dragon boss"},{file:"farm.png",sha256:sources[1].sha256,description:"Harvest the farm wheat and crops"}]};
 await fs.writeFile(path.join(folder,"acs-media.json"),JSON.stringify(manifest));return{root,folder,dir,run,manifest};
}
describe("Grounded shot matching, owned PNG fixtures and explicit embedding test double",()=>{
 it("uses app-owned SHA metadata for new runs and keeps previous matching input immutable",async()=>{
  const f=await fixture(),store=new DataStore(f.root);await store.init();const target=store.p("studio","artifacts",f.run.id);await fs.mkdir(store.p("studio","artifacts"),{recursive:true});await fs.rename(f.dir,target);f.dir=target;for(const source of f.run.sources)source.file=path.join(target,path.basename(source.file));await new StudioStore(store).saveRun(f.run);
  const catalog=new StudioMediaCatalog(store),asset=f.run.sources[0];await catalog.save({runId:f.run.id,sha256:asset.sha256,expectedRevision:0,displayName:"Owner boss",description:"Fight the dragon boss"});const result=await matchStudioShots({store} as any,f.run,f.dir),pinned=await fs.readFile(path.join(f.dir,"source-matching-input.json"));
  expect(result.assignments[1].sha256).toBe(asset.sha256);await catalog.save({runId:f.run.id,sha256:asset.sha256,expectedRevision:1,displayName:"Owner farm",description:"Harvest the farm wheat and crops"});await matchStudioShots({store} as any,f.run,f.dir);expect(await fs.readFile(path.join(f.dir,"source-matching-input.json"))).toEqual(pinned);
  const next={...f.run,id:randomUUID()},nextDir=store.p("studio","artifacts",next.id);await fs.mkdir(nextDir);const fresh=await matchStudioShots({store} as any,next,nextDir);expect(fresh.candidates.find((row:any)=>row.sha256===asset.sha256).description).toBe("Harvest the farm wheat and crops");
 });
 it("replaces round-robin using exact-SHA descriptions, pins original annotations and never approves meaning or rights",async()=>{
  const f=await fixture();state.calls=0;const report=await matchStudioShots({} as any,f.run,f.dir);
  expect(f.run.shots.map(row=>row.asset)).toEqual([f.run.sources[1].file,f.run.sources[0].file]);expect(report.assignments.map((row:any)=>row.method)).toEqual(["LEXICAL_OWNER_DESCRIPTION","LEXICAL_OWNER_DESCRIPTION"]);expect(report.visualUnderstanding).toBe("NOT_PERFORMED");expect(report.publicationApproval).toBe(false);expect(state.calls).toBe(0);
  await fs.writeFile(path.join(f.folder,"acs-media.json"),"changed original manifest");const again=await matchStudioShots({} as any,f.run,f.dir);expect(again.reportSha256).toBe(report.reportSha256);expect(again.at).toBe(report.at);
  await fs.appendFile(f.run.sources[0].file,"changed bytes");await expect(matchStudioShots({} as any,f.run,f.dir)).rejects.toThrow("Pinned media changed");
 });
 it("validates embedding output text identities, uses pinned vectors and does not silently downgrade configured inference failures",async()=>{
  const f=await fixture(true);state.calls=0;state.corrupt=false;const result=await matchStudioShots({} as any,f.run,f.dir);expect(state.calls).toBe(1);expect(result.method).toBe("LOCAL_TEXT_EMBEDDING");expect(f.run.shots[0].asset).toBe(f.run.sources[1].file);expect(result.embedding.engine).toContain("TEST_DOUBLE");
  const second=await fixture(true);state.corrupt=true;await expect(matchStudioShots({} as any,second.run,second.dir)).rejects.toThrow("text identity changed");state.corrupt=false;
 });
 it("keeps missing descriptions unknown and deduplicates identical source content",async()=>{
  const f=await fixture(true);state.calls=0;await fs.unlink(path.join(f.folder,"acs-media.json"));f.run.sources.push({...f.run.sources[0]});const result=await matchStudioShots({} as any,f.run,f.dir);expect(result.candidates).toHaveLength(2);expect(result.coverage.unannotatedAssignments).toBe(2);expect(result.assignments.every((row:any)=>row.score===null&&row.semanticReview==="UNKNOWN")).toBe(true);expect(state.calls).toBe(0);
 });
 it("rejects stale metadata, redirected basenames, duplicate hashes and impossible scene annotations",async()=>{
  const f=await fixture();f.manifest.assets[0].sha256="0".repeat(64);await fs.writeFile(path.join(f.folder,"acs-media.json"),JSON.stringify(f.manifest));await expect(matchStudioShots({} as any,f.run,f.dir)).rejects.toThrow("does not match any pinned source");
  expect(StudioMediaAnnotations.safeParse({version:1,assets:[{...f.manifest.assets[0],file:"../escape.png"}]}).success).toBe(false);
  expect(StudioMediaAnnotations.safeParse({version:1,assets:[f.manifest.assets[0],f.manifest.assets[0]]}).success).toBe(false);
  const other=await fixture();(other.manifest.assets[0] as any).segments=[{startSec:1,endSec:3,description:"The owner annotated scene"}];await fs.writeFile(path.join(other.folder,"acs-media.json"),JSON.stringify(other.manifest));await expect(matchStudioShots({} as any,other.run,other.dir)).rejects.toThrow("Still images cannot contain timed scene");
 });
 it("skips measured unusable intervals and caps consecutive source repetition when an alternative exists",()=>{
  const candidates=[{id:"a",file:"boss.mp4",sha256:"a",description:"dragon boss",origin:"OWNER_ANNOTATION" as const,startSec:2,endSec:5,excludedReason:null},{id:"b",file:"farm.mp4",sha256:"b",description:"farm",origin:"OWNER_ANNOTATION" as const,startSec:0,endSec:3,excludedReason:null},{id:"bad",file:"bad.mp4",sha256:"bad",description:"dragon boss",origin:"OWNER_ANNOTATION" as const,startSec:0,endSec:3,excludedReason:"Measured black footage"}];
  const rows=chooseStudioMedia(Array.from({length:5},()=>({text:"dragon boss"})),candidates,null);expect(rows.some(row=>row.candidateId==="bad")).toBe(false);expect(rows[2].candidateId).toBe("b");expect(rows[0].sourceStart).toBe(2);expect(rows[0].sourceDuration).toBe(3);expect(rows.some(row=>row.reused)).toBe(true);
  expect(metadataSimilarity("rồng tấn công","Rong tan cong")).toBe(1);
 });
 it("probes actual video bounds before accepting an owner-declared timed scene",async()=>{
  const f=await fixture(),file=path.join(f.dir,"owned-test-pattern.mp4"),result=await runProcess(path.resolve(".local/tools/ffmpeg.exe"),["-y","-f","lavfi","-i","testsrc2=s=160x90:r=10:d=2","-threads","2","-c:v","libx264",file]);expect(result.code).toBe(0);
  const bytes=await fs.readFile(file),source={file,sha256:createHash("sha256").update(bytes).digest("hex"),size:bytes.length};f.run.sources=[source];f.run.config.ffprobe=path.resolve(".local/tools/ffprobe.exe");
  await fs.writeFile(path.join(f.folder,"acs-media.json"),JSON.stringify({version:1,assets:[{file:"owned-test-pattern.mp4",sha256:source.sha256,description:"Owner-generated FFmpeg moving pattern, not gameplay",segments:[{startSec:1,endSec:5,description:"Invalid range extending beyond actual two-second clip"}]}]}));
  await expect(matchStudioShots({} as any,f.run,f.dir)).rejects.toThrow("exceeds actual source duration");
 });
});
