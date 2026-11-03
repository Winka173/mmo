import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { StudioStore } from "@ttm/automation";
import { buildContext } from "../src/context.js";
import { executeStudio } from "../src/studio.js";
import { tmpDir } from "../../../packages/storage/test/helpers.js";
import {runProcess} from "@ttm/media";

const fixture = vi.hoisted(() => ({ audio: Buffer.alloc(0),tts:[] as string[] }));
vi.mock("../src/local-engine.js", () => ({ invokeLocalEngine: async (_ctx: unknown, _config: unknown, request: any) => {
  if (request.op.endsWith("environment")) return { fingerprint: "caption-contract-mock-runtime" };
  if (request.op === "tts") { fixture.tts.push(request.output);await fs.writeFile(request.output, fixture.audio); return { engine: "sine-fixture-not-speech" }; }
  if (request.op === "vad") return { engine: "silero-vad", device: "cpu", fixture: "MOCK_INTERVALS_NOT_INFERENCE", results: [...request.audio].reverse().map((file: string) => ({ file, duration: 1, speech: file.endsWith("voice-0.wav") ? [{ start: 0.2, end: 0.8 }] : [], leading_silence: 0.2, trailing_silence: 0.2 })) };
  throw new Error(`Unexpected operation ${request.op}`);
} }));

describe("caption artifact pipeline contract (mock AI/VAD, actual FFmpeg)", () => {
  it("aligns fresh narration to frame boundaries and preserves unrelated segment bytes during a one-line revision",async()=>{
    fixture.tts=[];const ctx=await buildContext({dataDir:await tmpDir("acs-frame-timing-")}),studio=new StudioStore(ctx.store),root=process.cwd(),source=ctx.store.p("owned");await fs.mkdir(source,{recursive:true});
    await sharp({create:{width:640,height:360,channels:3,background:"#533978"}}).png().toFile(source+"/owned.png");
    const tone=ctx.store.p("tone.wav");expect((await runProcess(root+"/.local/tools/ffmpeg.exe",["-y","-f","lavfi","-i","sine=frequency=220:duration=1.237","-ar","24000","-ac","1",tone])).code).toBe(0);fixture.audio=await fs.readFile(tone);
    await studio.saveConfig({ffmpeg:root+"/.local/tools/ffmpeg.exe",ffprobe:root+"/.local/tools/ffprobe.exe"});
    const now=new Date().toISOString(),pilot=await studio.saveAutopilot({id:randomUUID(),name:"Frame timing contract",family:"custom",sourceFolder:source,scriptText:"A.\n\nB.\n\nC.",rights:"AUTHORIZED_REUSE",rightsEvidence:"Owned image and synthetic tone; no speech quality approval",createdAt:now,updatedAt:now}),queued=await studio.enqueue(pilot,"en-US",randomUUID());
    expect((await studio.run(queued.id))?.renderTimingVersion).toBe(2);await executeStudio(ctx,queued.id);
    const dir=ctx.store.p("studio","artifacts",queued.id),qa=JSON.parse(await fs.readFile(dir+"/qa.json","utf8")),timeline=(await studio.timeline(queued.id))!;
    expect(qa.technical).toBe(true);expect(qa.renderTiming).toMatchObject({version:2,frameTimedNarration:true,plannedFrames:141,measuredVideoFrames:141});expect(timeline.duration).toBeCloseTo(4.7,6);expect(Math.abs(qa.duration-timeline.duration)).toBeLessThan(1/30+.02);
    expect(timeline.clips.filter(clip=>clip.track==="dialogue").map(clip=>clip.duration)).toEqual([1.237,1.237,1.237]);
    expect(timeline.clips.find(clip=>clip.id==="video-1")?.start).toBeCloseTo(47/30,6);expect(fixture.tts).toHaveLength(3);
    const unchanged=await Promise.all([0,2].map(index=>fs.readFile(`${dir}/segment-${index}.mp4`))),parent=await fs.readFile(dir+"/final.mp4");
    const child=await studio.reviseNarration(queued.id,1,"Updated B.");await executeStudio(ctx,child.id);
    const childDir=ctx.store.p("studio","artifacts",child.id),childQa=JSON.parse(await fs.readFile(childDir+"/qa.json","utf8"));expect(childQa.technical).toBe(true);expect(childQa.renderTiming.measuredVideoFrames).toBe(141);expect(fixture.tts).toHaveLength(4);expect(fixture.tts.at(-1)).toContain("voice-1.wav");
    expect(await fs.readFile(childDir+"/segment-0.mp4")).toEqual(unchanged[0]);expect(await fs.readFile(childDir+"/segment-2.mp4")).toEqual(unchanged[1]);expect(await fs.readFile(dir+"/final.mp4")).toEqual(parent);expect(child.renderTimingVersion).toBe(2);
    await fs.writeFile(ctx.store.p("frame-timing-result.json"),JSON.stringify({status:"VERIFIED_ACTUAL_FFMPEG_WITH_MOCK_TONE_NOT_SPEECH",parentId:queued.id,childId:child.id,parent:path.join(dir,"final.mp4"),child:path.join(childDir,"final.mp4"),timelineDuration:timeline.duration,parentRenderTiming:qa.renderTiming,childRenderTiming:childQa.renderTiming,ttsCalls:fixture.tts.length,unchangedSegments:[0,2],originalPreserved:true}));
  },120000);
  it("flags a missed creative target even when actual encode and caption readability pass",async()=>{
    const ctx=await buildContext({dataDir:await tmpDir("acs-creative-duration-")}),studio=new StudioStore(ctx.store),root=process.cwd(),source=ctx.store.p("owned-source");await fs.mkdir(source,{recursive:true});
    await sharp({create:{width:640,height:360,channels:3,background:"#5946aa"}}).png().toFile(source+"/owned.png");
    const audio=ctx.store.p("tone.wav"),made=await runProcess(root+"/.local/tools/ffmpeg.exe",["-y","-f","lavfi","-i","sine=frequency=220:duration=1.8","-ar","24000","-ac","1",audio]);expect(made.code).toBe(0);fixture.audio=await fs.readFile(audio);
    await studio.saveConfig({ffmpeg:root+"/.local/tools/ffmpeg.exe",ffprobe:root+"/.local/tools/ffprobe.exe"});
    const now=new Date().toISOString(),pilot=await studio.saveAutopilot({id:randomUUID(),name:"Duration target fixture",sourceFolder:source,scriptText:"A.",durationSec:30,rights:"AUTHORIZED_REUSE",rightsEvidence:"Owned synthetic image and tone; not narration quality acceptance",createdAt:now,updatedAt:now});
    const {id}=await studio.enqueue(pilot,"en-US",randomUUID());await executeStudio(ctx,id);
    const run=(await studio.run(id))!,qa=JSON.parse(await fs.readFile(ctx.store.p("studio","artifacts",id,"qa.json"),"utf8"));
    expect(qa.technical).toBe(true);expect(qa.captionQuality.readability.status).toBe("pass");expect(qa.findings.find((f:any)=>f.criterion==="creative_duration_target").status).toBe("unknown");
    expect(run.stages.find(s=>s.id==="quality")).toMatchObject({state:"flagged",note:expect.stringContaining("creative_duration_target")});expect(run.stages.find(s=>s.id==="eligibility")?.state).toBe("blocked");
  },60000);
  it("exports current speech-bound estimates, fallback and readability evidence without modifying audio or script", async () => {
    const ctx = await buildContext({ dataDir: await tmpDir("acs-caption-contract-") }), studio = new StudioStore(ctx.store);
    const source = ctx.store.p("owned-source"); await fs.mkdir(source, { recursive: true });
    await sharp({ create: { width: 640, height: 360, channels: 3, background: "#49346d" } }).png().toFile(source + "/owned.png");
    const pcm = Buffer.alloc(44 + 24000 * 2); pcm.write("RIFF"); pcm.writeUInt32LE(pcm.length - 8, 4); pcm.write("WAVEfmt ", 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(24000, 24); pcm.writeUInt32LE(48000, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(48000, 40);
    for (let i = 0; i < 24000; i++) pcm.writeInt16LE(Math.round(1800 * Math.sin(2 * Math.PI * 220 * i / 24000)), 44 + i * 2);
    fixture.audio = pcm;
    const root = process.cwd(); await studio.saveConfig({ ffmpeg: root + "/.local/tools/ffmpeg.exe", ffprobe: root + "/.local/tools/ffprobe.exe", vadModel: "contract-mock-no-checkpoint-loaded" });
    const now = new Date().toISOString(), autopilot = await studio.saveAutopilot({ id: randomUUID(), name: "Caption contract fixture", sourceFolder: source, scriptText: "ACS giữ dấu Việt.\n\nKeep this original line.", rights: "AUTHORIZED_REUSE", rightsEvidence: "Owned generated image and sine wave; mock AI contract only", createdAt: now, updatedAt: now });
    const { id } = await studio.enqueue(autopilot, "en-US", randomUUID()); await executeStudio(ctx, id);
    const dir = ctx.store.p("studio", "artifacts", id), run = (await studio.run(id))!;
    const evidence = JSON.parse(await fs.readFile(dir + "/caption-quality.json", "utf8")), qa = JSON.parse(await fs.readFile(dir + "/qa.json", "utf8")), timeline = await studio.timeline(id);
    expect(run.state).toBe("ready"); expect(run.outputs).toContain("caption-quality.json");
    expect(evidence.captionTiming).toBe("estimated"); expect(evidence.wordAlignment).toBe("UNVERIFIED");
    expect(evidence.timing.map((t: any) => t.method)).toEqual(["SPEECH_BOUND_ESTIMATE", "VAD_NO_SPEECH"]);
    // The fast line is re-timed into the held silence instead of only being reported (grouping v3).
    expect(evidence.readability.findings.map((f: any) => f.criterion)).not.toContain("caption.reading_speed"); expect(evidence.grouping.readingTime.changedCues).toBeGreaterThan(0);
    expect(qa.captionQuality).toEqual(evidence);
    expect(timeline?.captionTiming).toBe("estimated");
    const captions = timeline!.clips.filter(c => c.track === "caption");
    expect(captions.map(c => c.text)).toEqual(["ACS giữ dấu Việt.", "Keep this original line."]);
    // Speech-bound starts were 0.2 s and 1.3 s; both lines were too fast, so each may start earlier (lead-in) and use the held silence,
    // never overlapping the next line, reaching at least 0.8 s and at most 20 characters per second.
    expect(captions[0].start).toBeGreaterThanOrEqual(0); expect(captions[0].start).toBeLessThanOrEqual(0.2 + 1e-6); expect(captions[1].start).toBeLessThanOrEqual(1.3 + 1e-6);
    expect(captions[0].start + captions[0].duration).toBeLessThanOrEqual(captions[1].start + 1e-6);
    for (const c of captions) { expect(c.duration).toBeGreaterThanOrEqual(0.8); expect([...c.text!].length / c.duration).toBeLessThanOrEqual(20 + 1e-6); }
    expect(await fs.readFile(dir + "/voice-0.wav")).toEqual(pcm); expect(await fs.readFile(dir + "/voice-1.wav")).toEqual(pcm);
  }, 60000);
});
