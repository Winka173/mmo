import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export type LockInfo = { pid: number; host: string; acquiredAt: string; heartbeatAt: string; purpose: string };

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
  private held = false;

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

  isStale(info: LockInfo | null, now = Date.now()): boolean {
    if (!info) return true;
    if (now - new Date(info.heartbeatAt).getTime() > this.ttlMs) return true;
    if (info.host === os.hostname() && !pidAlive(info.pid)) return true;
    return false;
  }

  async tryAcquire(): Promise<boolean> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const now = new Date().toISOString();
    const info: LockInfo = { pid: process.pid, host: os.hostname(), acquiredAt: now, heartbeatAt: now, purpose: this.opts.purpose ?? "" };
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
        if (!this.isStale(cur)) return false;
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
    this.timer = setInterval(() => void this.beat(), every);
    this.timer.unref();
  }

  async beat(): Promise<void> {
    if (!this.held) return;
    const cur = await this.read();
    if (!cur || cur.pid !== process.pid || cur.host !== os.hostname()) {
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
    if (!this.held) return;
    this.held = false;
    const cur = await this.read();
    if (cur && cur.pid === process.pid && cur.host === os.hostname()) await fs.rm(this.file, { force: true });
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
