import * as fs from "node:fs/promises";
import { FactoryError, newId, nowIso } from "@ttm/core";
import { DataStore, readJson, writeJsonAtomic } from "@ttm/storage";
import { redact } from "@ttm/storage";
import { z } from "zod";
import type { TelegramClient } from "./client.js";

export const OutboxMessage = z.object({
  id: z.string(),
  chatId: z.string(),
  kind: z.enum(["text", "photo", "video"]),
  text: z.string(),
  file: z.string().nullable().default(null),
  /** messages with the same dedupeKey inside the window are merged/skipped */
  dedupeKey: z.string().nullable().default(null),
  attempts: z.number().int().default(0),
  notBefore: z.string().nullable().default(null),
  createdAt: z.string(),
  lastError: z.string().nullable().default(null),
});
export type OutboxMessage = z.infer<typeof OutboxMessage>;

/**
 * Persistent outbox: alerts are written to disk first, then delivered. Survives restarts,
 * obeys 429 retry_after, falls back from video/photo to text, and debounces repeats.
 */
export class TelegramOutbox {
  constructor(
    private readonly store: DataStore,
    private readonly opts: { debounceMs?: number; maxAttempts?: number } = {},
  ) {}

  private dir(sub: "outbox" | "sent") {
    return this.store.p("telegram", sub);
  }

  async enqueue(msg: Omit<OutboxMessage, "id" | "attempts" | "createdAt" | "notBefore" | "lastError" | "file" | "dedupeKey"> & { file?: string | null; dedupeKey?: string | null }): Promise<string | null> {
    const debounce = this.opts.debounceMs ?? 10 * 60_000;
    if (msg.dedupeKey) {
      const recent = await this.recent(debounce);
      if (recent.some((m) => m.dedupeKey === msg.dedupeKey && m.chatId === msg.chatId)) return null;
    }
    const m = OutboxMessage.parse({ ...msg, text: redact(msg.text), id: newId("tg_"), createdAt: nowIso() });
    await writeJsonAtomic(this.store.p("telegram", "outbox", `${m.id}.json`), m, { keepBackup: false });
    return m.id;
  }

  private async recent(windowMs: number): Promise<OutboxMessage[]> {
    const out: OutboxMessage[] = [];
    const cutoff = Date.now() - windowMs;
    for (const sub of ["outbox", "sent"] as const) {
      for (const n of await fs.readdir(this.dir(sub)).catch(() => [] as string[])) {
        const m = await readJson(this.store.p("telegram", sub, n), OutboxMessage).catch(() => null);
        if (m && new Date(m.createdAt).getTime() >= cutoff) out.push(m);
      }
    }
    return out;
  }

  async pending(): Promise<OutboxMessage[]> {
    const names = (await fs.readdir(this.dir("outbox")).catch(() => [] as string[])).sort();
    const out: OutboxMessage[] = [];
    for (const n of names) {
      const m = await readJson(this.store.p("telegram", "outbox", n), OutboxMessage).catch(() => null);
      if (m) out.push(m);
    }
    return out;
  }

  async flush(client: TelegramClient | null): Promise<{ sent: number; failed: number; deferred: number }> {
    let sent = 0;
    let failed = 0;
    let deferred = 0;
    if (!client) return { sent, failed, deferred: (await this.pending()).length };
    for (const m of await this.pending()) {
      if (m.notBefore && new Date(m.notBefore).getTime() > Date.now()) {
        deferred++;
        continue;
      }
      const file = this.store.p("telegram", "outbox", `${m.id}.json`);
      try {
        if (m.kind !== "text" && m.file) {
          try {
            if (m.kind === "video") await client.sendVideo(m.chatId, m.file, m.text);
            else await client.sendPhoto(m.chatId, m.file, m.text);
          } catch (e) {
            if (e instanceof FactoryError && e.code === "TG_TOO_LARGE") await client.sendMessage(m.chatId, `${m.text}\n\n(File quá lớn để gửi qua bot — xem trên dashboard nội bộ: ${m.file})`);
            else throw e;
          }
        } else await client.sendMessage(m.chatId, m.text);
        await writeJsonAtomic(this.store.p("telegram", "sent", `${m.id}.json`), { ...m, attempts: m.attempts + 1 }, { keepBackup: false });
        await fs.rm(file, { force: true });
        sent++;
      } catch (e: any) {
        const attempts = m.attempts + 1;
        const giveUp = attempts >= (this.opts.maxAttempts ?? 8) || (e instanceof FactoryError && (e.errorClass === "PERMANENT" || e.code === "TG_UNAUTHORIZED"));
        const retryAfter = e instanceof FactoryError && e.extra.retryAfter ? e.extra.retryAfter : new Date(Date.now() + 30_000 * 2 ** attempts).toISOString();
        if (giveUp) {
          await writeJsonAtomic(this.store.p("telegram", "sent", `${m.id}.failed.json`), { ...m, attempts, lastError: e.message }, { keepBackup: false });
          await fs.rm(file, { force: true });
          await this.store.audit({ actor: "telegram", action: "telegram.give_up", subject: m.id, detail: { error: e.message } });
          failed++;
        } else {
          await writeJsonAtomic(file, { ...m, attempts, notBefore: retryAfter, lastError: e.message }, { keepBackup: false });
          deferred++;
          if (e instanceof FactoryError && e.code === "TG_RATE_LIMIT") break; // stop hammering
        }
      }
    }
    return { sent, failed, deferred };
  }
}
