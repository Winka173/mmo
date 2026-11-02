import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { VoiceStore, hash } from "@ttm/automation";
import { FactoryError } from "@ttm/core";
import { invokeLocalEngine } from "./local-engine.js";
import { reviewNarration } from "@ttm/quality";
import type { Ctx } from "./context.js";

export async function executeVoiceSample(ctx: Ctx, id: string): Promise<Record<string, unknown>> {
  const voices = new VoiceStore(ctx.store); const row = await voices.get(id);
  if (!row) throw new FactoryError("VOICE_MISSING", "PERMANENT", "Voice sample not found");
  if (row.state === "ready") return { id, state: row.state };
  if (hash(row.config) !== row.configHash) throw new FactoryError("QUALITY_LOCK", "BLOCKED", "Voice configuration changed");
  const request = ctx.store.p("studio", "voice-audio", `${id}.request.json`);
  const output = voices.audio(id); await fs.mkdir(path.dirname(output), { recursive: true });
  try {
    await voices.save({ ...row, state: "running", error: null });
    const evidence=await invokeLocalEngine(ctx,row.config,{op:"tts",language:row.language,text:row.text,output},request);
    if (evidence.language !== row.language || !(evidence.audio_seconds > 0)) throw new Error("Voice engine returned invalid language or duration");
    const audioSha256 = createHash("sha256").update(await fs.readFile(output)).digest("hex");
    if (row.config.asrModel && row.config.pythonAsr) {
      const asrRequest = ctx.store.p("studio", "voice-audio", `${id}.asr.request.json`);
      try{
        const asr=await invokeLocalEngine(ctx,row.config,{op:"asr",audio:[output]},asrRequest);
        evidence.roundTrip=asr.results?.length===1?{...reviewNarration(row.text,asr.results[0].text,row.language,asr.results[0].language),engine:asr}:{status:"unknown",reason:"Incomplete ASR response"};
      }catch(error:any){if(error instanceof FactoryError&&["GPU_BUSY","ENGINE_COOLDOWN","STUDIO_PAUSED"].includes(error.code))throw error;evidence.roundTrip={status:"unknown",reason:String(error.message??error)};}
    } else evidence.roundTrip = { status: "unknown", reason: "ASR not configured" };
    await voices.save({ ...row, state: "ready", error: null, evidence, audioSha256 });
    await ctx.store.audit({ actor: "worker", action: "voice.generated", subject: id, detail: { language: row.language, audioSha256 } });
    return { id, state: "ready", audioSha256 };
  } catch (e: any) {
    const message = String(e.message ?? e); const waiting=e instanceof FactoryError&&["GPU_BUSY","ENGINE_COOLDOWN","STUDIO_PAUSED"].includes(e.code);await voices.save({ ...row, state: waiting?"queued":"failed", error: message });
    if(waiting)throw e;
    if (message.includes("GPU_BUSY")) throw new FactoryError("GPU_BUSY", "RETRYABLE", message, { retryAfter: new Date(Date.now() + 60000).toISOString() });
    throw new FactoryError("VOICE_ENGINE", "HUMAN_REQUIRED", message);
  }
}
