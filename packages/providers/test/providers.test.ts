import { Claim } from "@ttm/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NotConfiguredLlm, OpenAiCompatibleLlm, verifyClaim, briefToStoryboard, deriveCutdownBrief, TopicBrief } from "../src/index.js";
import { tmpDir } from "../../storage/test/helpers.js";

describe("LLM providers", () => {
  it("rejects cloud/remote endpoints before any fetch", async () => {
    const cacheDir = await tmpDir(); let calls = 0;
    for (const baseUrl of ["https://api.openai.com/v1", "http://llm.test/v1", "http://127.0.0.1@remote.test/v1", "https://127.0.0.1/v1"]) {
      expect(() => new OpenAiCompatibleLlm({ baseUrl, model: "m", cacheDir, fetchImpl: (async () => { calls++; return new Response(); }) as any })).toThrow("Cloud AI disabled");
    }
    expect(calls).toBe(0);
  });
  it("local requests refuse redirects and report zero paid AI cost", async () => {
    let options: RequestInit | undefined;
    const llm = new OpenAiCompatibleLlm({ baseUrl: "http://127.0.0.1:11434/v1", model: "m", cacheDir: await tmpDir(), usdPer1kTokens: 100,
      fetchImpl: (async (_url: string, init: RequestInit) => { options = init; return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })); }) as any });
    await llm.completeJson({ system: "s", user: "u" }, z.object({ ok: z.boolean() }));
    expect(options?.redirect).toBe("error"); expect(llm.estimateUsd({ system: "s", user: "u" })).toBe(0);
  });
  it("unconfigured runtime never fabricates output", async () => {
    await expect(new NotConfiguredLlm().completeJson({ system: "", user: "" }, z.object({}))).rejects.toMatchObject({ code: "NEEDS_PROVIDER" });
  });
  it("malformed JSON is retried a bounded number of times, then held; 429 is retryable", async () => {
    let calls = 0;
    const llm = new OpenAiCompatibleLlm({ baseUrl: "http://127.0.0.1:11434/v1", model: "m", cacheDir: await tmpDir(), maxAttempts: 2, fetchImpl: (async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: "{not json" } }] })); }) as any });
    await expect(llm.completeJson({ system: "s", user: "u" }, z.object({ a: z.string() }))).rejects.toMatchObject({ code: "LLM_MALFORMED", errorClass: "BLOCKED" });
    expect(calls).toBe(2);
    const rl = new OpenAiCompatibleLlm({ baseUrl: "http://127.0.0.1:11434/v1", model: "m", cacheDir: await tmpDir(), fetchImpl: (async () => new Response("{}", { status: 429 })) as any });
    await expect(rl.completeJson({ system: "s", user: "u2" }, z.object({}))).rejects.toMatchObject({ code: "LLM_RATE_LIMIT", errorClass: "RETRYABLE" });
  });
  it("valid output is cached by request hash", async () => {
    let calls = 0;
    const opts = { baseUrl: "http://127.0.0.1:11434/v1", model: "m", cacheDir: await tmpDir(), fetchImpl: (async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: '{"a":"x"}' } }] })); }) as any };
    const llm = new OpenAiCompatibleLlm(opts);
    await llm.completeJson({ system: "s", user: "u" }, z.object({ a: z.string() }));
    await llm.completeJson({ system: "s", user: "u" }, z.object({ a: z.string() }));
    expect(calls).toBe(1);
  });
});

describe("fact verification", () => {
  const claim = Claim.parse({ id: "cl-1", text: "x", riskTier: "MEDIUM", status: "SOURCED_UNFETCHED", sources: [
    { url: "https://a.test", title: "A", publisher: "A", tier: "primary", fetchedAt: null, excerpt: null },
    { url: "https://b.test", title: "B", publisher: "B", tier: "secondary", fetchedAt: null, excerpt: null } ] });
  const pages: Record<string, string> = { "https://a.test": "<p>Sidereal orbit period (days) 224.701</p>", "https://b.test": "<p>about 225 Earth days</p>" };
  const f = (async (u: string) => new Response(pages[u] ?? "", { status: pages[u] ? 200 : 404 })) as any;
  it("VERIFIED only when enough independent publishers contain the evidence", async () => {
    const r = await verifyClaim(claim, { "https://a.test": ["224.701"], "https://b.test": ["225 Earth days"] }, { fetchImpl: f });
    expect(r.claim.status).toBe("VERIFIED");
    expect(r.claim.sources.every((s) => s.fetchedAt && s.contentSha256)).toBe(true);
    const weak = await verifyClaim(claim, { "https://a.test": ["224.701"], "https://b.test": ["243 days"] }, { fetchImpl: f });
    expect(weak.claim.status).toBe("SOURCED_UNFETCHED");
  });
});

describe("script generation", () => {
  it("deterministic storyboard cites sources; cutdowns come from our own long brief", () => {
    const brief = TopicBrief.parse({ projectId: "prj-1", title: "T", hook: "H", hookNarration: "h", cta: "C", ctaNarration: "c", points: [{ title: "A", narration: "a", claimIds: ["cl-1"], chapterTitle: "Ch A" }, { title: "B", narration: "b", chapterTitle: "Ch B" }] });
    const claim = Claim.parse({ id: "cl-1", text: "x", riskTier: "LOW", status: "VERIFIED", sources: [{ url: "https://a.test", title: "A", publisher: "NASA", tier: "primary", fetchedAt: null, excerpt: null }] });
    const sb = briefToStoryboard(brief, "long_16x9", "FACT", [claim]);
    expect(sb.scenes[1].sourceCaption).toBe("NASA");
    expect(sb.scenes.map((s) => s.chapterTitle).filter(Boolean)).toEqual(["Mở đầu", "Ch A", "Ch B", "Tổng kết"]);
    expect(deriveCutdownBrief(brief, [1], "prj-2", "cut").points.map((p) => p.title)).toEqual(["B"]);
  });
});
