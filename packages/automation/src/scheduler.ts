import { DataStore, readJson, withLock, writeJsonAtomic } from "@ttm/storage";
import { z } from "zod";
import { Cron } from "./cron.js";

export type ScheduleDef = { name: string; cron: string; run: (slot: Date) => Promise<void> };

const ScheduleState = z.record(z.object({ lastSlot: z.string().nullable(), lastRunAt: z.string().nullable() }));

/**
 * Persistent scheduler. Each slot (schedule name + scheduled minute) runs at most once:
 * - lastSlot persisted after a successful run;
 * - on startup, the most recent missed slot is replayed ONCE (sleep/shutdown catch-up), older ones are skipped;
 * - schedule callbacks should enqueue idempotent jobs keyed by slot, so two instances can't double-run.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly crons: { def: ScheduleDef; cron: Cron }[];
  constructor(
    private readonly store: DataStore,
    defs: ScheduleDef[],
    private readonly timezone: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.crons = defs.map((def) => ({ def, cron: new Cron(def.cron, timezone) }));
  }

  private file() {
    return this.store.p("state", "schedules.json");
  }

  private async state() {
    return (await readJson(this.file(), ScheduleState)) ?? {};
  }

  /** Run every schedule whose latest due slot hasn't run yet. Returns names that ran. */
  async tick(): Promise<string[]> {
    const ran: string[] = [];
    for (const { def, cron } of this.crons) {
      const slot = cron.previous(this.now(), 2 * 24 * 60);
      if (!slot) continue;
      const st = await this.state();
      const last = st[def.name]?.lastSlot;
      if (last && new Date(last).getTime() >= slot.getTime()) continue;
      // Claim the slot first under lock so a concurrent instance can't run it too.
      const claimed = await withLock(this.store.p("locks", "scheduler.lock"), async () => {
        const s2 = await this.state();
        const l2 = s2[def.name]?.lastSlot;
        if (l2 && new Date(l2).getTime() >= slot.getTime()) return false;
        s2[def.name] = { lastSlot: slot.toISOString(), lastRunAt: this.now().toISOString() };
        await writeJsonAtomic(this.file(), s2);
        return true;
      });
      if (!claimed) continue;
      await this.store.audit({ actor: "scheduler", action: "schedule.fire", subject: def.name, detail: { slot: slot.toISOString(), catchUp: this.now().getTime() - slot.getTime() > 120_000 } });
      try {
        await def.run(slot);
        ran.push(def.name);
      } catch (e: any) {
        await this.store.audit({ actor: "scheduler", action: "schedule.error", subject: def.name, detail: { error: e?.message } });
      }
    }
    return ran;
  }

  start(intervalMs = 30_000) {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  nextRuns(): { name: string; next: string | null }[] {
    return this.crons.map(({ def, cron }) => ({ name: def.name, next: cron.next(this.now())?.toISOString() ?? null }));
  }
}
