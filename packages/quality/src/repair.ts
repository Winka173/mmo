import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Storyboard } from "@ttm/core";
import { ffmpeg, type RenderOutput } from "@ttm/media";
import { judgeVideo, type JudgeInput, type JudgeReport, type RepairAction } from "./judge.js";

export type RepairLogEntry = { iteration: number; at: string; verdict: JudgeReport["verdict"]; editorialScore: number; failed: string[]; actions: { action: RepairAction; detail: string }[]; scenesRerendered: string[]; version: string };

export type RepairResult = {
  status: "PASS" | "NEEDS_REVIEW";
  final: RenderOutput;
  reports: JudgeReport[];
  log: RepairLogEntry[];
  reason: string | null;
};

/**
 * Auto-repair loop (spec U1): judge → apply ONLY the repairs the judge proposed → re-render only the
 * affected scenes (segment cache) → judge again. Bounded (default 2). Rights/fact blockers are
 * never "repaired" by retrying. Every version is kept (renders/<format>/v1, v2…) with the trail.
 */
export async function judgeAndRepair(opts: {
  storyboard: Storyboard;
  first: RenderOutput;
  outDir: string;
  judge: Omit<JudgeInput, "file" | "srt" | "sceneTimings" | "storyboard">;
  rerender: (patch: { storyboard: Storyboard; subtitleMaxChars?: number }) => Promise<RenderOutput>;
  maxIterations?: number;
  /** rights/fact gate blocked => judge only, no repair loop */
  blockedByRightsOrFacts?: boolean;
  subtitleMaxChars?: number;
  /** render work dir — lets RERENDER_SCENE drop cached segments of the affected scenes */
  workDir?: string;
}): Promise<RepairResult> {
  const max = opts.maxIterations ?? 2;
  let sb = structuredClone(opts.storyboard);
  let render = opts.first;
  let maxChars = opts.subtitleMaxChars ?? (sb.format === "short_9x16" ? 30 : 46);
  const reports: JudgeReport[] = [];
  const log: RepairLogEntry[] = [];
  const keep = async (it: number) => {
    const dir = path.join(opts.outDir, `v${it + 1}`);
    await fs.mkdir(dir, { recursive: true });
    for (const f of [render.video, render.srt]) await fs.copyFile(f, path.join(dir, path.basename(f)));
    return path.relative(opts.outDir, dir);
  };
  for (let it = 0; ; it++) {
    const rep = await judgeVideo({ ...opts.judge, file: render.video, srt: render.srt, sceneTimings: render.sceneTimings, storyboard: sb });
    reports.push(rep);
    const version = await keep(it);
    const entry: RepairLogEntry = { iteration: it, at: new Date().toISOString(), verdict: rep.verdict, editorialScore: rep.editorialScore, failed: rep.hard.filter((h) => !h.ok).map((h) => h.code), actions: [], scenesRerendered: [], version };
    log.push(entry);
    if (rep.verdict === "PASS") return { status: "PASS", final: render, reports, log, reason: null };
    if (opts.blockedByRightsOrFacts) return { status: "NEEDS_REVIEW", final: render, reports, log, reason: "cổng quyền/fact đang chặn — không tự sửa bằng cách dựng lại" };
    if (rep.verdict === "NEEDS_REVIEW") return { status: "NEEDS_REVIEW", final: render, reports, log, reason: `lỗi không tự sửa được: ${entry.failed.join(", ")}` };
    if (it >= max) return { status: "NEEDS_REVIEW", final: render, reports, log, reason: `đã thử sửa ${max} lần, còn lỗi: ${entry.failed.join(", ")}` };

    let needRerender = false;
    for (const step of rep.repairPlan) {
      if (step.action === "SUBTITLE_REFLOW") {
        // first go to the format's readable default, then tighten further
        const safeDefault = sb.format === "short_9x16" ? 30 : 46;
        const next = maxChars > safeDefault ? safeDefault : Math.max(18, Math.floor(maxChars * 0.75));
        entry.actions.push({ action: step.action, detail: `chia lại phụ đề: ${maxChars} → ${next} ký tự/câu` });
        maxChars = next;
        needRerender = true;
      } else if (step.action === "TRIM_SILENCE") {
        const ids = step.sceneIds.length ? step.sceneIds : sb.scenes.filter((s) => s.minSeconds > 4).map((s) => s.id);
        sb = { ...sb, scenes: sb.scenes.map((s) => (ids.includes(s.id) ? { ...s, minSeconds: 1 } : s)) };
        entry.actions.push({ action: step.action, detail: `rút ngắn cảnh lặng theo độ dài lời đọc: ${ids.join(", ") || "(không xác định)"}` });
        needRerender = true;
      } else if (step.action === "LOUDNESS_FIX") {
        const tmp = `${render.video}.loud.mp4`;
        await ffmpeg(["-i", render.video, "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-2:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", tmp]);
        await fs.rename(tmp, render.video);
        entry.actions.push({ action: step.action, detail: "chuẩn hóa lại độ ồn −14 LUFS, đỉnh −2 dBTP (giữ nguyên hình)" });
      } else if (step.action === "RERENDER_SCENE") {
        entry.actions.push({ action: step.action, detail: `dựng lại cảnh: ${step.sceneIds.join(", ") || "toàn bộ"}` });
        if (opts.workDir) {
          const idx = sb.scenes.map((s, i) => (step.sceneIds.includes(s.id) || !step.sceneIds.length ? i : -1)).filter((i) => i >= 0);
          for (const n of await fs.readdir(opts.workDir).catch(() => [] as string[])) if (idx.some((i) => n.startsWith(`seg-${String(i).padStart(2, "0")}-`))) await fs.rm(path.join(opts.workDir, n), { force: true });
        }
        needRerender = true;
      }
    }
    if (needRerender) {
      render = await opts.rerender({ storyboard: sb, subtitleMaxChars: maxChars });
      entry.scenesRerendered = (render as RenderOutput & { scenesRendered?: string[] }).scenesRendered ?? [];
    }
  }
}
