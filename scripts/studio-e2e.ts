import * as fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DataStore } from "@ttm/storage";
import { Autopilot, StudioStore } from "@ttm/automation";
import { runProcess } from "@ttm/media";
import { buildContext } from "../apps/worker/src/context.js";
import { executeStudio } from "../apps/worker/src/studio.js";

async function main(){
 const root=process.cwd(), testRoot=path.join(root,".local/e2e-studio"), source=path.join(testRoot,"fixture-input");await fs.mkdir(source,{recursive:true});
 const ffmpeg=path.join(root,".local/tools/ffmpeg.exe"),ffprobe="C:/Users/Winka/Tools/trellis2/tools/python/ffprobe.exe";
 const create=await runProcess(ffmpeg,["-y","-f","lavfi","-i","testsrc2=s=640x360:r=30","-vf","drawtext=text='ACS SOFTWARE TEST FIXTURE - NOT GAMEPLAY':fontsize=18:fontcolor=white:box=1:boxcolor=black:x=10:y=15","-t","12","-c:v","libx264",path.join(source,"fixture.mp4")]);assert.equal(create.code,0,create.stderr);
 const store=new DataStore(path.join(testRoot,"data"));await store.init();const studio=new StudioStore(store);
 const vi=process.argv.includes("--vi");const language=vi?"vi-VN":"en-US";
 const asr=process.argv.includes("--asr");
 await studio.saveConfig({python:path.join(root,".local/engines/speech/Scripts/python.exe"),pythonVi:path.join(root,".local/engines/vieneu/Scripts/python.exe"),pythonAsr:asr?path.join(root,".local/engines/asr/Scripts/python.exe"):"",asrModel:asr?path.join(root,".local/models/qwen3-asr"):"",asrDevice:"cuda",ffmpeg,ffprobe,ttsEnModel:path.join(root,".local/models/kokoro"),voiceEn:"af_heart",ttsDevice:vi||process.argv.includes("--gpu")?"cuda":"cpu",ttsViModel:path.join(root,".local/models/vieneu"),ttsViCodec:path.join(root,".local/models/moss-nano"),voiceVi:"Minh Quân"});
 const now=new Date().toISOString();const a=await studio.saveAutopilot(Autopilot.parse({id:randomUUID(),name:"ACS FIXTURE — NOT GAMEPLAY",family:"custom",sourceFolder:source,brief:"Software test using generated calibration footage. No gameplay or public posting.",scriptText:"This is a clearly labeled software test fixture for Autonomous Creative Studio. It uses generated calibration footage, not real gameplay.\n\nOriginal source files are preserved. The narration and captions are created locally, and this export is not approved for public posting.",rights:"AUTHORIZED_REUSE",rightsEvidence:"Calibration testsrc2 created by this test with FFmpeg; text authored for this test.",languages:["en-US"],createdAt:now,updatedAt:now}));
 if(vi){a.languages=["vi-VN"];a.scriptText="Đây là video kiểm thử phần mềm, sử dụng hình ảnh hiệu chuẩn do chương trình tạo ra. Đây không phải cảnh chơi game thật.\n\nỨng dụng giữ lại nguồn gốc và các phiên bản trước. Giọng đọc và phụ đề được tạo trên máy để kiểm tra, chưa được duyệt đăng công khai.";}
 const {id}=await studio.enqueue(a,language,now);const ctx=await buildContext({dataDir:store.root});await executeStudio(ctx,id);
 const run=await studio.run(id);assert.equal(run?.state,"ready");assert.equal(run?.stages.find(s=>s.id==="eligibility")?.state,"blocked");
 const cut=await studio.cut(id,5,8);await executeStudio(ctx,cut.id);const child=await studio.run(cut.id);assert.equal(child?.state,"ready");
 const qa=JSON.parse(await fs.readFile(store.p("studio","artifacts",id,"qa.json"),"utf8"));const cutQa=JSON.parse(await fs.readFile(store.p("studio","artifacts",cut.id,"qa.json"),"utf8"));
 assert.ok(Math.abs(qa.duration-cutQa.duration-3)<0.15);assert.equal((await studio.run(id))?.state,"ready");
 const revision=await studio.reviseNarration(id,0,vi?"Câu này đã được sửa để kiểm tra biên tập giọng đọc tiếng Việt. Hình ảnh hiệu chuẩn và phiên bản gốc vẫn được giữ nguyên.":"This revised sentence is a local editing test. The original calibration footage and earlier version remain unchanged.");await executeStudio(ctx,revision.id);
 const oldVoice=await fs.readFile(store.p("studio","artifacts",id,"voice-1.wav"));const reusedVoice=await fs.readFile(store.p("studio","artifacts",revision.id,"voice-1.wav"));assert.deepEqual(reusedVoice,oldVoice);
 assert.deepEqual(await fs.readFile(store.p("studio","artifacts",id,"segment-1.mp4")),await fs.readFile(store.p("studio","artifacts",revision.id,"segment-1.mp4")));
 if(asr){assert.ok(Array.isArray(qa.voiceReview));assert.ok(qa.voiceReview.every((r:any)=>r.status==="pass"),JSON.stringify(qa.voiceReview));}
 assert.equal((await studio.run(id))?.shots[0].text,run?.shots[0].text);assert.equal((await studio.run(revision.id))?.state,"ready");
 const report={status:"VERIFIED",fixture:true,genuineGameplay:false,language,humanListening:"NOT_REVIEWED",asr:asr?qa.voiceReview:"NOT_CONFIGURED",runId:id,cutId:cut.id,narrationRevisionId:revision.id,originalSeconds:qa.duration,cutSeconds:cutQa.duration,outputs:store.p("studio","artifacts",id),checks:[vi?"real local VieNeu CUDA inference":"real local Kokoro inference","FFmpeg render","SRT","thumbnail","decode QA","3-second deterministic cut","parent preserved","publication blocked","one narration segment revised","unrelated voice and rendered segment bytes preserved"],at:new Date().toISOString()};
 await fs.mkdir("docs/evidence",{recursive:true});await fs.writeFile(vi?"docs/evidence/acs-e2e-vi.json":"docs/evidence/acs-e2e.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
