/** Minimal 5-field cron matcher evaluated in an IANA timezone (DST-safe: evaluates wall-clock fields). */

type Field = Set<number>;
const RANGES: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

function parseField(expr: string, [min, max]: [number, number]): Field {
  const out = new Set<number>();
  for (const part of expr.split(",")) {
    const [rangeRaw, stepRaw] = part.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`Cron step không hợp lệ: ${part}`);
    let lo: number;
    let hi: number;
    if (rangeRaw === "*") [lo, hi] = [min, max];
    else if (rangeRaw.includes("-")) [lo, hi] = rangeRaw.split("-").map(Number) as [number, number];
    else {
      lo = Number(rangeRaw);
      hi = stepRaw ? max : lo;
    }
    if (![lo, hi].every(Number.isInteger) || lo < min || hi > max + (max === 6 ? 1 : 0) || lo > hi) throw new Error(`Cron giá trị ngoài phạm vi: ${part}`);
    for (let v = lo; v <= hi; v += step) out.add(max === 6 && v === 7 ? 0 : v);
  }
  return out;
}

export class Cron {
  private readonly fields: Field[];
  private readonly domStar: boolean;
  private readonly dowStar: boolean;
  constructor(public readonly expr: string, public readonly timezone: string) {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error(`Cron cần 5 trường: "${expr}"`);
    this.fields = parts.map((p, i) => parseField(p, RANGES[i]));
    this.domStar = parts[2] === "*";
    this.dowStar = parts[4] === "*";
  }

  private wall(d: Date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: this.timezone,
      hourCycle: "h23",
      minute: "numeric",
      hour: "numeric",
      day: "numeric",
      month: "numeric",
      weekday: "short",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    return [Number(get("minute")), Number(get("hour")), Number(get("day")), Number(get("month")), dow];
  }

  matches(d: Date): boolean {
    const [mi, h, dom, mon, dow] = this.wall(d);
    if (!this.fields[0].has(mi) || !this.fields[1].has(h) || !this.fields[3].has(mon)) return false;
    const domOk = this.fields[2].has(dom);
    const dowOk = this.fields[4].has(dow);
    // POSIX: when both day fields are restricted, either may match
    if (!this.domStar && !this.dowStar) return domOk || dowOk;
    return domOk && dowOk;
  }

  /** Most recent matching minute <= `from`, searching back up to `lookbackMinutes`. */
  previous(from: Date, lookbackMinutes = 8 * 24 * 60): Date | null {
    const t = new Date(Math.floor(from.getTime() / 60_000) * 60_000);
    for (let i = 0; i <= lookbackMinutes; i++) {
      const c = new Date(t.getTime() - i * 60_000);
      if (this.matches(c)) return c;
    }
    return null;
  }

  next(from: Date, lookaheadMinutes = 8 * 24 * 60): Date | null {
    const t = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000);
    for (let i = 0; i <= lookaheadMinutes; i++) {
      const c = new Date(t.getTime() + i * 60_000);
      if (this.matches(c)) return c;
    }
    return null;
  }
}
