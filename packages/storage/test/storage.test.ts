import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Settings } from "@ttm/core";
import { describe, expect, it } from "vitest";
import { DataStore, FileLock, SecretStore, createBackup, listBackups, readJson, readJsonl, appendJsonl, redact, restoreBackup, safeJoin, writeJsonAtomic } from "../src/index.js";
import { tmpDir } from "./helpers.js";

describe("atomic file storage", () => {
  it("writes atomically and keeps a .bak of the previous version", async () => {
    const d = await tmpDir();
    const f = path.join(d, "a.json");
    await writeJsonAtomic(f, { v: 1 });
    await writeJsonAtomic(f, { v: 2 });
    expect(JSON.parse(await fs.readFile(f, "utf8")).v).toBe(2);
    expect(JSON.parse(await fs.readFile(`${f}.bak`, "utf8")).v).toBe(1);
    expect((await fs.readdir(d)).filter((n) => n.endsWith(".tmp"))).toHaveLength(0);
  });

  it("repairs a corrupted file (half-written) from .bak and quarantines the corrupt copy", async () => {
    const store = new DataStore(await tmpDir());
    await store.init();
    await store.updateSettings((s) => ({ ...s, paused: true }), "test");
    await store.updateSettings((s) => ({ ...s, killSwitch: true }), "test");
    await fs.writeFile(store.p("config/settings.json"), '{"schemaVersion":1,"killSw'); // crash mid-write
    const s = await store.getSettings();
    expect(s.paused).toBe(true);
    expect((await fs.readdir(store.p("quarantine"))).length).toBe(1);
  });

  it("throws an actionable error when both primary and backup are corrupt", async () => {
    const d = await tmpDir();
    const f = path.join(d, "s.json");
    await fs.writeFile(f, "{bad");
    await fs.writeFile(`${f}.bak`, "{bad");
    await expect(readJson(f, Settings, { quarantineDir: path.join(d, "q") })).rejects.toThrow(/File hỏng/);
  });

  it("rejects path traversal and Windows-reserved names; supports Vietnamese/Chinese names", () => {
    expect(() => safeJoin("/data", "../etc/passwd")).toThrow();
    expect(() => safeJoin("/data", "projects", "..", "x")).toThrow();
    expect(() => safeJoin("/data", "CON.json")).toThrow();
    expect(() => safeJoin("/data", "a:b")).toThrow();
    expect(safeJoin("/data", "chủ-đề", "视频.json")).toContain("视频.json");
  });

  it("skips a truncated last JSONL line instead of failing", async () => {
    const f = path.join(await tmpDir(), "audit.jsonl");
    await appendJsonl(f, { a: 1 });
    await fs.appendFile(f, '{"a":2,"tru');
    const r = await readJsonl(f);
    expect(r.records).toEqual([{ a: 1 }]);
    expect(r.skipped).toBe(1);
  });
});

describe("FileLock", () => {
  it("is exclusive and takes over a stale lock (dead pid)", async () => {
    const f = path.join(await tmpDir(), "w.lock");
    const a = new FileLock(f, { ttlMs: 60_000 });
    const b = new FileLock(f, { ttlMs: 60_000 });
    expect(await a.tryAcquire()).toBe(true);
    expect(await b.tryAcquire()).toBe(false);
    await a.release();
    // simulate a crashed owner: lock file left behind by a dead pid
    await fs.writeFile(f, JSON.stringify({ pid: 999999, host: (await import("node:os")).hostname(), acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), purpose: "x" }));
    expect(await b.tryAcquire()).toBe(true);
    await b.release();
  });

  it("treats an expired heartbeat as stale", async () => {
    const f = path.join(await tmpDir(), "w.lock");
    await fs.writeFile(f, JSON.stringify({ pid: process.pid, host: "other-host", acquiredAt: "2020-01-01T00:00:00Z", heartbeatAt: "2020-01-01T00:00:00Z", purpose: "x" }));
    const l = new FileLock(f, { ttlMs: 1000 });
    expect(await l.tryAcquire()).toBe(true);
    await l.release();
  });
});

describe("secrets & backups", () => {
  it("encrypts secrets at rest and never stores plaintext", async () => {
    const store = new DataStore(await tmpDir());
    await store.init();
    const s = new SecretStore(store);
    await s.set("telegram.botToken", "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(await fs.readFile(store.p("secrets", "telegram.botToken.secret"), "utf8")).not.toContain("AAAAAAAA");
    expect(await s.get("telegram.botToken")).toBe("123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(redact("token 123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA end")).toBe("token [telegram-token] end");
  });

  it("backs up and restores JSON state", async () => {
    const store = new DataStore(await tmpDir());
    await store.init();
    await store.updateSettings((s) => ({ ...s, paused: true }), "t");
    const b = await createBackup(store);
    expect(b.files).toBeGreaterThan(0);
    await store.updateSettings((s) => ({ ...s, paused: false }), "t");
    await restoreBackup(store, path.basename(b.dir));
    expect((await store.getSettings()).paused).toBe(true);
    expect((await listBackups(store)).length).toBe(2); // + safety backup
  });
});
