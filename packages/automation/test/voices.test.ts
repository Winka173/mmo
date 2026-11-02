import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { DataStore } from "@ttm/storage";
import { tmpDir } from "../../storage/test/helpers.js";
import { VoiceStore, discoverStudioTools } from "../src/voices.js";
import { StudioStore } from "../src/studio.js";
import { FileQueue } from "../src/queue.js";

describe("Durable voice auditions", () => {
  it("keeps a config snapshot across settings changes and never marks queued audio reviewed", async () => {
    const store = new DataStore(await tmpDir("acs-voices-")); await store.init();
    const studio = new StudioStore(store); await studio.saveConfig({ voiceEn: "af_heart", ttsDevice: "cpu" });
    const voices = new VoiceStore(store); const row = await voices.enqueue({ language: "en-US", text: "Actual audition request" });
    await studio.saveConfig({ voiceEn: "another-voice", ttsDevice: "cuda" });
    const persisted = await new VoiceStore(store).get(row.id);
    expect(persisted?.config.voiceEn).toBe("af_heart"); expect(persisted?.humanReview).toBe("NOT_REVIEWED");
    const jobs = await new FileQueue(store).list("queued"); expect(jobs.some(j => j.kind === "STUDIO_VOICE" && j.payload.sampleId === row.id && !j.usesGpu)).toBe(true);
    await expect(voices.review(row.id, "ACCEPTED", "not-a-real-file")).rejects.toThrow("completed sample");
    await expect(voices.enqueue({ language: "zh-CN", text: "Unsupported language" })).rejects.toThrow();
  });
  it("ties human review to exact audio bytes and rejects stale or tampered samples", async () => {
    const store = new DataStore(await tmpDir("acs-voice-review-")); await store.init(); const voices = new VoiceStore(store);
    const row = await voices.enqueue({ language: "vi-VN", text: "Mẫu kiểm tra." });
    // Storage contract fixture; not a synthesis/quality acceptance.
    const bytes = Buffer.from("storage-test-audio"); const digest = createHash("sha256").update(bytes).digest("hex");
    await fs.mkdir(path.dirname(voices.audio(row.id)), { recursive: true }); await fs.writeFile(voices.audio(row.id), bytes);
    await voices.save({ ...row, state: "ready", audioSha256: digest });
    await expect(voices.review(row.id, "ACCEPTED", "stale")).rejects.toThrow();
    const accepted = await voices.review(row.id, "ACCEPTED", digest); expect(accepted.humanReview).toBe("ACCEPTED"); expect(accepted.reviewedAt).not.toBeNull();
    await fs.writeFile(voices.audio(row.id), "changed-file");
    await expect(voices.review(row.id, "REJECTED", digest)).rejects.toThrow("audio changed");
  });
  it("discovery only inspects the selected setup root and preserves other configuration", async () => {
    const root = await tmpDir("acs-detect-"); const model = path.join(root, ".local/models/kokoro"); await fs.mkdir(model, { recursive: true });
    const store = new DataStore(await tmpDir("acs-detect-store-")); await store.init(); const config = await new StudioStore(store).config();
    const result = await discoverStudioTools(root, { ...config, llmModel: "keep-installed-llm" });
    expect(result.found).toEqual(["ttsEnModel"]); expect(result.config.ttsEnModel).toBe(model); expect(result.config.llmModel).toBe("keep-installed-llm");
    expect((await new StudioStore(store).config()).ttsEnModel).toBe(""); // discovery does not save configuration
    await expect(discoverStudioTools("relative-folder", config)).rejects.toThrow("absolute");
  });
});
