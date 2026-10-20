export type ScheduleItem = {
  id: string;
  projectId: string;
  /** brand id or gameId — cadence is per owner per platform */
  owner: string;
  platform: string;
  priority: number;
  lineageId: string | null;
  isLongForm: boolean;
  /** earliest allowed (approval time, embargo end, release window start) */
  notBefore: string | null;
  /** last moment the content is still fresh/valid; after it must be revalidated */
  freshUntil: string | null;
  /** approval window for REVIEW items (slot must be inside) */
  approvalUntil?: string | null;
};

export type OwnerRule = { postsPerDay: number; preferredHours: number[]; minGapHours: number };
export type CalendarDay = { date: string; label: string; source: string; avoid: boolean };

export type ScheduleConfig = {
  tzOffsetHours: number;
  rules: Record<string, OwnerRule>;
  defaultRule: OwnerRule;
  quietHours: [number, number];
  /** verified calendar only (holidays/special events) — entries without a source are ignored */
  calendar: CalendarDay[];
  /** e.g. YouTube uploads/day under API quota */
  platformDailyQuota: Record<string, number>;
  /** derived Shorts of one lineage must be ≥ this many days apart, never same day as the long video */
  lineageSpacingDays: number;
  /** already-booked slots (published or scheduled) */
  booked: { owner: string; platform: string; at: string; lineageId: string | null; isLongForm: boolean }[];
};

export type SchedulePlan = { assigned: { itemId: string; at: string; reason: string }[]; deferred: { itemId: string; reason: string }[] };

const dayKey = (d: Date, tz: number) => new Date(d.getTime() + tz * 3600_000).toISOString().slice(0, 10);
const hourOf = (d: Date, tz: number) => new Date(d.getTime() + tz * 3600_000).getUTCHours();

/**
 * SmartScheduleEngine — deterministic slot assignment. After an outage the backlog is spread over
 * future preferred slots (never a midnight burst); stale items are flagged for revalidation.
 */
export function planSchedule(items: ScheduleItem[], cfg: ScheduleConfig, now: Date, horizonDays = 14): SchedulePlan {
  const tz = cfg.tzOffsetHours;
  const booked = [...cfg.booked];
  const assigned: SchedulePlan["assigned"] = [];
  const deferred: SchedulePlan["deferred"] = [];
  const holidays = new Map(cfg.calendar.filter((c) => c.source && c.avoid).map((c) => [c.date, c.label]));
  const sorted = [...items].sort((a, b) => a.priority - b.priority || (a.notBefore ?? "").localeCompare(b.notBefore ?? ""));
  for (const it of sorted) {
    const rule = cfg.rules[it.owner] ?? cfg.defaultRule;
    if (it.freshUntil && new Date(it.freshUntil) < now) {
      deferred.push({ itemId: it.id, reason: "nội dung đã quá hạn tươi (giá/fact/build) — cần kiểm tra lại trước khi xếp lịch" });
      continue;
    }
    const start = new Date(Math.max(now.getTime() + 15 * 60_000, it.notBefore ? new Date(it.notBefore).getTime() : 0));
    let found: { at: Date; reason: string } | null = null;
    for (let d = 0; d < horizonDays && !found; d++) {
      const day = new Date(start.getTime() + d * 86400_000);
      const dk = dayKey(day, tz);
      if (holidays.has(dk)) continue;
      const sameOwnerDay = booked.filter((b) => b.owner === it.owner && b.platform === it.platform && dayKey(new Date(b.at), tz) === dk).length;
      if (sameOwnerDay >= rule.postsPerDay) continue;
      const platformDay = booked.filter((b) => b.platform === it.platform && dayKey(new Date(b.at), tz) === dk).length;
      if (platformDay >= (cfg.platformDailyQuota[it.platform] ?? Infinity)) continue;
      if (it.lineageId) {
        const sib = booked.filter((b) => b.lineageId === it.lineageId);
        const tooClose = sib.some((b) => Math.abs(new Date(dk).getTime() - new Date(dayKey(new Date(b.at), tz)).getTime()) < cfg.lineageSpacingDays * 86400_000 || (b.isLongForm !== it.isLongForm && dayKey(new Date(b.at), tz) === dk));
        if (tooClose) continue;
      }
      for (const h of rule.preferredHours) {
        if (h >= cfg.quietHours[0] && h < cfg.quietHours[1]) continue;
        const at = new Date(`${dk}T${String(h).padStart(2, "0")}:00:00Z`);
        const atUtc = new Date(at.getTime() - tz * 3600_000);
        if (atUtc < start) continue;
        if (it.approvalUntil && atUtc > new Date(it.approvalUntil)) continue;
        const gapOk = booked.filter((b) => b.owner === it.owner && b.platform === it.platform).every((b) => Math.abs(new Date(b.at).getTime() - atUtc.getTime()) >= rule.minGapHours * 3600_000);
        if (!gapOk) continue;
        found = { at: atUtc, reason: `${dk} ${h}:00 (giờ ưu tiên của ${it.owner})` };
        break;
      }
    }
    if (!found) {
      deferred.push({ itemId: it.id, reason: `không có slot hợp lệ trong ${horizonDays} ngày (nhịp/khoảng cách/ngày lễ/quota)` });
      continue;
    }
    assigned.push({ itemId: it.id, at: found.at.toISOString(), reason: found.reason });
    booked.push({ owner: it.owner, platform: it.platform, at: found.at.toISOString(), lineageId: it.lineageId, isLongForm: it.isLongForm });
  }
  return { assigned, deferred };
}

export { hourOf };
