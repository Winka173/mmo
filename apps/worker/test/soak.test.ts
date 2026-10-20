import { describe, expect, it } from "vitest";
import { runSoak } from "../src/soak.js";
import { tmpDir } from "../../../packages/storage/test/helpers.js";

describe("Wave 7 soak — 7 accelerated daily cycles", () => {
  it("survives injected faults with caps respected, no duplicate posts, daily reports, $0 spend", async () => {
    const r = await runSoak({ dataDir: await tmpDir("ttm-soak-"), days: 7 });
    expect(r.invariants).toEqual({ noDuplicateRemotePosts: true, dailyCapRespected: true, everyDayReported: true, noPaidSpend: true, tiktokNeverMarkedPublished: true, corruptJobQuarantined: true, telegramOutboxQueued: true });
    expect(r.days.filter((d) => d.published === 1).length).toBeGreaterThanOrEqual(5);
    expect(r.days[3].recovered?.requeued).toBe(1);
  }, 600_000);
});
