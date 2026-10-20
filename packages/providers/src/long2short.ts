import { FactoryError, type Claim, type Storyboard } from "@ttm/core";
import { TopicBrief } from "./script.js";

export type SegmentPick = { pointIndexes: number[]; start: number; end: number; score: number; reasons: string[] };

/**
 * LongToShortsEngine (spec X3): only for OWNED or licensed long videos. Picks high-information,
 * standalone-able segments from the long storyboard + real render timings (not a blind crop),
 * excludes hook/CTA/credits and anything marked as spoiler/reveal.
 */
export function selectSegments(x: {
  long: TopicBrief;
  storyboard: Storyboard;
  sceneTimings: { sceneId: string; start: number; duration: number }[];
  claims: Claim[];
  owned: boolean;
  rightsOk: boolean;
  k: number;
  spoilerPointIndexes?: number[];
  minSec?: number;
  maxSec?: number;
}): { picks: SegmentPick[]; rejected: string[] } {
  if (!x.owned && !x.rightsOk) throw new FactoryError("LONG2SHORT_RIGHTS", "BLOCKED", "Chỉ cắt Shorts từ video dài thuộc sở hữu hoặc có giấy phép phái sinh");
  const k = Math.max(1, Math.min(5, x.k));
  const minSec = x.minSec ?? 12;
  const maxSec = x.maxSec ?? 50;
  const rejected: string[] = [];
  // map brief points -> storyboard scenes (point scenes are s01.., in order)
  const pointScenes = x.storyboard.scenes.filter((s) => !["hook", "cta", "credits"].includes(s.kind));
  const scored = pointScenes.map((s, i) => {
    const t = x.sceneTimings.find((y) => y.sceneId === s.id);
    const verified = s.claimIds.filter((id) => x.claims.find((c) => c.id === id)?.status === "VERIFIED").length;
    const words = s.narration.split(/\s+/).length;
    const score = verified * 3 + s.claimIds.length + s.bullets.length * 0.5 + Math.min(4, words / 15) + (s.chapterTitle ? 1 : 0);
    return { i, s, t, score, reasons: [`${s.claimIds.length} claim (${verified} đã kiểm chứng)`, `${words} từ`, s.chapterTitle ? `chương "${s.chapterTitle}"` : ""].filter(Boolean) };
  });
  const used = new Set<number>();
  const picks: SegmentPick[] = [];
  for (const i of x.spoilerPointIndexes ?? []) rejected.push(`điểm ${i + 1}: spoiler/kết luận — không cắt riêng`);
  for (const c of [...scored].sort((a, b) => b.score - a.score)) {
    if (picks.length >= k) break;
    if (used.has(c.i) || !c.t) continue;
    if (x.spoilerPointIndexes?.includes(c.i)) continue;
    let idx = [c.i];
    let dur = c.t.duration;
    const next = scored[c.i + 1];
    if (dur < minSec && next?.t && !used.has(next.i) && !x.spoilerPointIndexes?.includes(next.i)) {
      idx = [c.i, next.i];
      dur += next.t.duration;
    }
    if (dur < minSec - 6) {
      rejected.push(`điểm ${c.i + 1}: quá ngắn (${dur.toFixed(1)}s) để đứng riêng`);
      continue;
    }
    if (dur > maxSec) {
      rejected.push(`điểm ${c.i + 1}: quá dài (${dur.toFixed(1)}s) cho Short`);
      continue;
    }
    idx.forEach((i) => used.add(i));
    const ts = idx.map((i) => scored[i].t!);
    picks.push({ pointIndexes: idx, start: ts[0].start, end: ts.at(-1)!.start + ts.at(-1)!.duration, score: Math.round(idx.reduce((a, i) => a + scored[i].score, 0) * 10) / 10, reasons: idx.flatMap((i) => scored[i].reasons) });
  }
  return { picks: picks.sort((a, b) => a.start - b.start), rejected };
}

/**
 * A standalone Short re-scripted for viewers who never saw the long video: new hook phrased as a
 * question, a one-line context setup, the segment's points, and a CTA to the full video. Never a raw
 * cut without context.
 */
export function standaloneShortBrief(long: TopicBrief, pick: SegmentPick, projectId: string, n: number): TopicBrief {
  const pts = pick.pointIndexes.map((i) => long.points[i]).filter(Boolean);
  const first = pts[0];
  const q = /[?？]$/.test(first.title) ? first.title : `Vì sao ${first.title.charAt(0).toLowerCase()}${first.title.slice(1)}?`;
  return TopicBrief.parse({
    ...long,
    projectId,
    title: `${first.title} (phần ${n})`,
    hook: q,
    hookNarration: `${q} Chủ đề: ${long.title}.`,
    points: pts.map((p) => ({ ...p, chapterTitle: null })),
    cta: "Xem bản đầy đủ trên kênh",
    ctaNarration: "Xem video đầy đủ trên kênh để hiểu trọn câu chuyện.",
  });
}

/** Release dates for derived Shorts: never the long video's day, spaced ≥ spacingDays (no bursts). */
export function shortReleaseDates(longPublishDay: string, count: number, spacingDays = 2): string[] {
  const base = new Date(`${longPublishDay}T00:00:00Z`).getTime();
  return Array.from({ length: count }, (_, i) => new Date(base + (i + 1) * Math.max(1, spacingDays) * 86400_000).toISOString().slice(0, 10));
}
