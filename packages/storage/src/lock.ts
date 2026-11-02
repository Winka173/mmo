import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

export type LockInfo = { pid: number; host: string; acquiredAt: string; heartbeatAt: string; purpose: string; ownerId?: string };
export type LockHealth = { status:"online"|"missing"|"invalid"|"dead"|"unresponsive"|"remote"|"unknown"; record:LockInfo|null; heartbeatAgeMs:number|null; checkedAt:string };

/** Read-only identity probe, only needed for expired locks whose PID still exists.
 * A reused Windows PID must not keep a crashed worker's lock alive indefinitely.
 * Unknown/inaccessible process identity always retains the lock.
 */
async function processStartedAt(pid: number): Promise<number | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (pid === process.pid) return Date.now() - process.uptime() * 1000;
  if (process.platform !== "win32") return null;
  return new Promise(resolve => {
    const script = `$ErrorActionPreference='Stop'; try { [Console]::Write(([DateTimeOffset](Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()) } catch { exit 2 }`;
    execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 4000, maxBuffer: 1024 }, (error, stdout) => {
        const value = Number(stdout.trim());
        resolve(!error && Number.isFinite(value) && value > 0 ? value : null);
      });
  });
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === "EPERM";
  }
}

/**
 * Cross-process lock via exclusive-create lock file holding PID/host/heartbeat.
 * Stale when heartbeat is older than ttl, or the owning PID on this host is gone.
 */
export class FileLock {
  private timer: NodeJS.Timeout | null = null;
  private heartbeatTask:Promise<void>|null=null;
  private held = false;
  private readonly ownerId = randomUUID();

  constructor(
    public readonly file: string,
    private readonly opts: { ttlMs?: number; heartbeatMs?: number; purpose?: string } = {},
  ) {}

  get ttlMs() {
    return this.opts.ttlMs ?? 60_000;
  }

  async read(): Promise<LockInfo | null> {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch {
      return null;
    }
  }

  /** Read-only status for UI/diagnostics. A lock file alone never proves liveness. */
  async health(now=Date.now()):Promise<LockHealth>{
    const result=(status:LockHealth["status"],record:LockInfo|null=null,heartbeatAgeMs:number|null=null):LockHealth=>({status,record,heartbeatAgeMs,checkedAt:new Date(now).toISOString()});
    let info:LockInfo;
    try{info=JSON.parse(await fs.readFile(this.file,"utf8"));}catch(error:any){return result(error.code==="ENOENT"?"missing":"invalid");}
    if(!info||!Number.isSafeInteger(info.pid)||info.pid<=0||typeof info.host!=="string"||!info.host||typeof info.purpose!=="string"||!Number.isFinite(Date.parse(info.acquiredAt))||!Number.isFinite(Date.parse(info.heartbeatAt)))return result("invalid");
    const age=now-Date.parse(info.heartbeatAt);
    if(age < -5000)return result("unknown",info,age);
    if(info.host!==os.hostname())return result("remote",info,age);
    try{process.kill(info.pid,0);}catch(error:any){return result(error.code==="ESRCH"?"dead":"unknown",info,age);}
    if(age>this.ttlMs){
      const started=await processStartedAt(info.pid);
      if(started!==null&&started>Date.parse(info.acquiredAt)+2000)return result("dead",info,age);
      return result("unresponsive",info,age);
    }
    return result("online",info,Math.max(0,age));
  }

  isStale(info: LockInfo | null, now = Date.now()): boolean {
    if (!info) return true;
    // A suspended local owner is still an owner; TTL alone cannot prove it died.
    if (info.host === os.hostname()) return !pidAlive(info.pid);
    if (now - new Date(info.heartbeatAt).getTime() > this.ttlMs) return true;
    return false;
  }

  private async canReclaim(info: LockInfo | null): Promise<boolean> {
    if (this.isStale(info)) return true;
    if (!info || info.host !== os.hostname() || Date.now() - Date.parse(info.heartbeatAt) <= this.ttlMs) return false;
    const acquired = Date.parse(info.acquiredAt);
    if (!Number.isFinite(acquired)) return false;
    const started = await processStartedAt(info.pid);
    // Clock/probe ambiguity keeps ownership. A process born after the lock cannot
    // be its original owner. The margin covers startup/time conversion rounding.
    return started !== null && started > acquired + 2000;
  }

  async tryAcquire(): Promise<boolean> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const now = new Date().toISOString();
    const info: LockInfo = { pid: process.pid, host: os.hostname(), acquiredAt: now, heartbeatAt: now, purpose: this.opts.purpose ?? "", ownerId: this.ownerId };
    for (let i = 0; i < 2; i++) {
      try {
        const h = await fs.open(this.file, "wx");
        await h.writeFile(JSON.stringify(info));
        await h.sync();
        await h.close();
        this.held = true;
        this.startHeartbeat();
        return true;
      } catch (e: any) {
        if (e.code !== "EEXIST") throw e;
        const cur = await this.read();
        // Exclusive creation and writing the owner record are separate syscalls.
        // An empty file may belong to a contender currently writing, not a dead owner.
        if (!cur) {
          const stat = await fs.stat(this.file).catch(() => null);
          if (!stat || Date.now() - stat.mtimeMs < this.ttlMs) return false;
        }
        if (!(await this.canReclaim(cur))) return false;
        // Stale: move aside atomically so only one contender wins the takeover.
        const aside = `${this.file}.stale.${process.pid}.${Date.now()}`;
        try {
          await fs.rename(this.file, aside);
          await fs.rm(aside, { force: true });
        } catch {
          return false;
        }
      }
    }
    return false;
  }

  private startHeartbeat() {
    const every = this.opts.heartbeatMs ?? Math.max(1000, Math.floor(this.ttlMs / 3));
    this.timer = setInterval(() => {
      if(this.heartbeatTask)return;
      // A transient disk/antivirus failure must not become an unhandled rejection
      // that terminates the worker. Health naturally becomes overdue if it persists.
      this.heartbeatTask=this.beat().catch(()=>{}).finally(()=>{this.heartbeatTask=null;});
    }, every);
    this.timer.unref();
  }

  async beat(): Promise<void> {
    if (!this.held) return;
    const cur = await this.read();
    if (!cur || cur.pid !== process.pid || cur.host !== os.hostname() || cur.ownerId !== this.ownerId) {
      this.held = false; // lock was taken over; stop claiming it
      if (this.timer) clearInterval(this.timer);
      return;
    }
    cur.heartbeatAt = new Date().toISOString();
    const tmp = `${this.file}.${process.pid}.hb`;
    await fs.writeFile(tmp, JSON.stringify(cur));
    await fs.rename(tmp, this.file).catch(() => fs.rm(tmp, { force: true }));
  }

  get isHeld() {
    return this.held;
  }

  async release(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // An in-flight heartbeat must finish before removing the record, otherwise
    // its rename can resurrect a released lock after shutdown.
    if(this.heartbeatTask)await this.heartbeatTask;
    if (!this.held) return;
    this.held = false;
    const cur = await this.read();
    if (cur && cur.pid === process.pid && cur.host === os.hostname() && cur.ownerId === this.ownerId) await fs.rm(this.file, { force: true });
  }
}

export async function withLock<T>(file: string, fn: () => Promise<T>, opts: { waitMs?: number; ttlMs?: number; purpose?: string } = {}): Promise<T> {
  const lock = new FileLock(file, { ttlMs: opts.ttlMs, purpose: opts.purpose });
  const deadline = Date.now() + (opts.waitMs ?? 10_000);
  while (!(await lock.tryAcquire())) {
    if (Date.now() > deadline) throw new Error(`Không lấy được khóa ${path.basename(file)} (đang có tiến trình khác giữ)`);
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
  }
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
