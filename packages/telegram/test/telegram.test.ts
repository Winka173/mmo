import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DataStore } from "@ttm/storage";
import { describe, expect, it, vi } from "vitest";
import { CommandRouter, TelegramClient, TelegramOutbox, chunkText, formatDailyReport, type CommandHandlers } from "../src/index.js";
import { tmpDir } from "../../storage/test/helpers.js";

const handlers = (): CommandHandlers => {
  const ok = async () => "ok";
  return { status: ok, today: ok, queue: ok, report: ok, cost: ok, channels: ok, pause: ok, resume: ok, approve: vi.fn(async (id) => `approved ${id}`), reject: ok, retry: ok, posted: ok };
};

describe("CommandRouter", () => {
  it("rejects unauthorized chats (and /start grants nothing)", async () => {
    const audit = vi.fn(async () => undefined);
    const r = new CommandRouter({ chatIds: ["1"] }, handlers(), audit);
    expect(await r.handle({ chatId: "2", userId: "9", text: "/start" })).toMatch(/chưa được cấp quyền/);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "telegram.unauthorized" }));
  });
  it("requires double confirmation for /approve, bound to the same user and expiring", async () => {
    let now = 0;
    const h = handlers();
    const r = new CommandRouter({ chatIds: ["1"] }, h, async () => undefined, () => now);
    const reply = (await r.handle({ chatId: "1", userId: "u", text: "/approve job_X" }))!;
    const code = /confirm (\d+)/.exec(reply)![1];
    expect(h.approve).not.toHaveBeenCalled();
    expect(await r.handle({ chatId: "1", userId: "other", text: `/confirm ${code}` })).toMatch(/không đúng/);
    now = 3 * 60_000;
    expect(await r.handle({ chatId: "1", userId: "u", text: `/confirm ${code}` })).toMatch(/hết hạn/);
    now = 0;
    const r2 = (await r.handle({ chatId: "1", userId: "u", text: "/approve job_Y" }))!;
    expect(await r.handle({ chatId: "1", userId: "u", text: `/confirm ${/confirm (\d+)/.exec(r2)![1]}` })).toBe("approved job_Y");
  });
});

describe("Telegram delivery", () => {
  it("chunks long messages under 4096 chars", () => {
    const parts = chunkText("a\n".repeat(5000));
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    expect(parts.join("\n").length).toBeGreaterThan(9000);
  });
  it("outbox persists, obeys 429, debounces duplicates, redacts tokens, falls back to text for oversize video", async () => {
    const store = new DataStore(await tmpDir());
    await store.init();
    const ob = new TelegramOutbox(store);
    await ob.enqueue({ chatId: "1", kind: "text", text: "lỗi token 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890", dedupeKey: "e1" });
    expect(await ob.enqueue({ chatId: "1", kind: "text", text: "lặp", dedupeKey: "e1" })).toBeNull();
    const big = path.join(await tmpDir(), "big.mp4");
    await fs.writeFile(big, Buffer.alloc(51 * 1024 * 1024));
    await ob.enqueue({ chatId: "1", kind: "video", text: "render xong", file: big });
    const sent: any[] = [];
    let first = true;
    const fetchImpl = (async (url: string, init: any) => {
      if (first) {
        first = false;
        return new Response(JSON.stringify({ ok: false, parameters: { retry_after: 0 } }), { status: 429 });
      }
      sent.push({ url, body: init.body });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    }) as any;
    const client = new TelegramClient("123456789:SECRET_TOKEN_SHOULD_NOT_LEAK_ANYWHERE_00", fetchImpl);
    expect((await ob.flush(client)).deferred).toBeGreaterThan(0);
    const pending = await ob.pending();
    for (const m of pending) await fs.writeFile(store.p("telegram", "outbox", `${m.id}.json`), JSON.stringify({ ...m, notBefore: null }));
    expect((await ob.flush(client)).sent).toBe(2);
    expect(String(sent[0].body)).toContain("[telegram-token]");
    expect(String(sent[1].body)).toMatch(/quá lớn/);
  });
  it("formats unknown metrics as unknown, not zero", () => {
    const t = formatDailyReport({ date: "2026-10-19", generatedAt: "", ideasConsidered: 0, ideasRejected: [], videosCompleted: { short: 1, long: 0 }, postsByPlatform: {}, postUrls: [], pendingApprovals: [], manualActions: [], metrics: null, shopee: null, cost: { totalUsd: 0, byProvider: {}, monthUsd: 0, monthCapUsd: 0 }, errors: [], retries: 0, suggestion: "s", mode: "demo" });
    expect(t).toMatch(/Lượt xem: chưa có dữ liệu/);
    expect(t).toMatch(/DEMO/);
  });
});
