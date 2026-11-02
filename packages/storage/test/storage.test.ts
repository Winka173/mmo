import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
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
  it("keeps ownership through a heartbeat write failure and releases without an unhandled rejection or resurrected record", async () => {
    const f=path.join(await tmpDir(),"heartbeat-failure.lock"),lock=new FileLock(f,{ttlMs:1000,heartbeatMs:15});
    const temp=`${f}.${process.pid}.hb`;await fs.mkdir(temp);
    try{
      expect(await lock.tryAcquire()).toBe(true);
      await new Promise(resolve=>setTimeout(resolve,80));
      expect(lock.isHeld).toBe(true);expect((await lock.read())?.pid).toBe(process.pid);
      await fs.rmdir(temp);
      await new Promise(resolve=>setTimeout(resolve,50));
      await lock.release();await new Promise(resolve=>setTimeout(resolve,30));
      await expect(fs.access(f)).rejects.toMatchObject({code:"ENOENT"});
      await expect(fs.access(temp)).rejects.toMatchObject({code:"ENOENT"});
    }finally{await lock.release();await fs.rmdir(temp).catch(()=>{});}
  });
  it("reclaims an expired record whose PID now belongs to a process born after acquisition", async () => {
    const f=path.join(await tmpDir(),"reused-pid.lock"),lock=new FileLock(f,{ttlMs:1000});
    await fs.writeFile(f,JSON.stringify({pid:process.pid,host:(await import("node:os")).hostname(),acquiredAt:"2020-01-01T00:00:00Z",heartbeatAt:"2020-01-01T00:00:00Z",purpose:"crashed-worker"}));
    expect(await lock.tryAcquire()).toBe(true);
    expect((await lock.read())?.ownerId).toBeTruthy();
    await lock.release();
  });
  it.runIf(process.platform === "win32")("checks an independent Windows process birth without stopping that process", async () => {
    const child=spawn(process.execPath,["-e","console.log('ready');setInterval(()=>{},1000)"],{windowsHide:true,stdio:["ignore","pipe","ignore"]});
    const f=path.join(await tmpDir(),"foreign-reused-pid.lock"),lock=new FileLock(f,{ttlMs:1000});
    try{
      await new Promise<void>((resolve,reject)=>{child.stdout!.once("data",()=>resolve());child.once("error",reject);});
      await fs.writeFile(f,JSON.stringify({pid:child.pid,host:(await import("node:os")).hostname(),acquiredAt:"2020-01-01T00:00:00Z",heartbeatAt:"2020-01-01T00:00:00Z",purpose:"simulated-reused-pid"}));
      expect(await lock.tryAcquire()).toBe(true);expect(()=>process.kill(child.pid!,0)).not.toThrow();
      await lock.release();
      await fs.writeFile(f,JSON.stringify({pid:child.pid,host:(await import("node:os")).hostname(),acquiredAt:new Date().toISOString(),heartbeatAt:"2020-01-01T00:00:00Z",purpose:"suspended-live-owner"}));
      expect(await lock.tryAcquire()).toBe(false);expect(()=>process.kill(child.pid!,0)).not.toThrow();
    }finally{await lock.release();child.kill();}
  },12000);
  it("retains a suspended owner and never heartbeats or releases a replacement identity with the same PID", async () => {
    const f=path.join(await tmpDir(),"identity.lock"),lock=new FileLock(f,{ttlMs:1000}),contender=new FileLock(f,{ttlMs:1000});
    expect(await lock.tryAcquire()).toBe(true);
    const owner=(await lock.read())!;
    await fs.writeFile(f,JSON.stringify({...owner,heartbeatAt:"2020-01-01T00:00:00Z"}));
    expect(await contender.tryAcquire()).toBe(false);
    const replacement={...owner,ownerId:"another-instance",heartbeatAt:"2020-01-01T00:00:00Z"};
    await fs.writeFile(f,JSON.stringify(replacement));
    await lock.beat();expect(lock.isHeld).toBe(false);
    await lock.release();expect(await lock.read()).toEqual(replacement);
  });
  it("does not steal a newly created empty record or a live local owner with an old heartbeat", async () => {
    const f=path.join(await tmpDir(),"creating.lock"),lock=new FileLock(f,{ttlMs:1000});
    await fs.writeFile(f,"");expect(await lock.tryAcquire()).toBe(false);
    await fs.writeFile(f,JSON.stringify({pid:process.pid,host:(await import("node:os")).hostname(),heartbeatAt:"2020-01-01T00:00:00Z"}));expect(await lock.tryAcquire()).toBe(false);
  });
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

describe("regression: deleted files are not resurrected from .bak", () => {
  it("readJson returns null for a removed file even if a .bak remains", async () => {
    const d = await tmpDir();
    const f = path.join(d, "job.json");
    await writeJsonAtomic(f, { schemaVersion: 1, killSwitch: true });
    await writeJsonAtomic(f, { schemaVersion: 1, killSwitch: false });
    await fs.rm(f);
    expect(await readJson(f, Settings)).toBeNull();
  });
});
