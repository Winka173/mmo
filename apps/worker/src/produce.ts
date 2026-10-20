import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  FactoryError,
  Platform,
  affiliateGate,
  factGate,
  idempotencyKey,
  nowIso,
  rightsGate,
  type Claim,
  type Format,
  type GateResult,
  type Project,
  type RightsManifest,
  type Storyboard,
} from "@ttm/core";
import { BrandIdentityEngine, FORMAT_SPECS, MACHINE_BRIGADE_BRAND, TU_TO_MO_BRAND, pickTts, qaVideo, renderStoryboard, toRenderKit } from "@ttm/media";
import { TopicBrief, briefToStoryboard, platformMetadata } from "@ttm/providers";
import { readJson, writeJsonAtomic } from "@ttm/storage";
import { z } from "zod";
import { notify, type Ctx } from "./context.js";

export const ProjectPlan = z.object({
  family: z.enum(["FACT", "PRODUCT", "ADAPT", "GAME"]),
  targets: z.array(Platform),
  summary: z.string(),
  hashtags: z.array(z.string()).default([]),
  badges: z.array(z.string()).default([]),
  /** Sample renders may be shorter than the production minimum (e.g. long-form sample < 5 min). */
  minSecOverride: z.number().nullable().default(null),
  /** owner brand id ("tutomo") or a gameId (legacy alias "machine-brigade" kept) */
  brand: z.string().default("tutomo"),
  signals: z.record(z.number()).default({}),
});
export type ProjectPlan = z.infer<typeof ProjectPlan>;

/** Content types whose explanatory scenes must each cite at least one claim. */
const CLAIM_COVERAGE_TYPES = new Set(["FACT_SHORT", "EXPLAINER_SHORT", "NEWS_SUMMARY", "YOUTUBE_LONG", "CHINA_INSPIRED_ORIGINAL", "AFFILIATE_REVIEW"]);

export function claimCoverageGate(project: Project, sb: Storyboard, claims: Claim[]): GateResult {
  if (!CLAIM_COVERAGE_TYPES.has(project.contentType)) return { ok: true, hold: null, reasons: [] };
  const reasons: string[] = [];
  for (const s of sb.scenes) {
    if (!["evidence", "comparison"].includes(s.kind) && !(s.kind === "point" && project.contentType !== "AFFILIATE_REVIEW")) continue;
    if (!s.claimIds.length) reasons.push(`cảnh "${s.title}" có nội dung khẳng định nhưng chưa gắn claim nguồn`);
    for (const id of s.claimIds) if (!claims.some((c) => c.id === id)) reasons.push(`cảnh "${s.title}" trỏ tới claim không tồn tại: ${id}`);
  }
  return reasons.length ? { ok: false, hold: "HOLD_FACTS", reasons } : { ok: true, hold: null, reasons: [] };
}

export async function loadProjectBundle(ctx: Ctx, projectId: string) {
  const project = await ctx.store.getProject(projectId);
  if (!project) throw new FactoryError("PROJECT_MISSING", "PERMANENT", `Không tìm thấy dự án ${projectId}`);
  const brief = await readJson(ctx.store.p("projects", projectId, "brief.json"), TopicBrief);
  if (!brief) throw new FactoryError("BRIEF_MISSING", "HUMAN_REQUIRED", `Dự án ${projectId} chưa có kịch bản (brief.json) — cần biên tập viên hoặc LLM runtime`);
  const plan = await readJson(ctx.store.p("projects", projectId, "plan.json"), ProjectPlan);
  if (!plan) throw new FactoryError("PLAN_MISSING", "HUMAN_REQUIRED", `Dự án ${projectId} thiếu plan.json`);
  const claims = await ctx.store.getClaims(projectId);
  const rights = await ctx.store.getRights(projectId);
  if (!rights) throw new FactoryError("RIGHTS_MISSING", "BLOCKED", `Dự án ${projectId} chưa có rights-manifest.json — không dựng khi chưa rõ quyền`);
  const product = project.productId ? await ctx.store.getProduct(project.productId) : null;
  return { project, brief, plan, claims, rights, product };
}

export function evaluateGates(b: { project: Project; claims: Claim[]; rights: RightsManifest; product: Awaited<ReturnType<Ctx["store"]["getProduct"]>>; storyboards: Storyboard[] }, now = new Date()) {
  const gates: Record<string, GateResult> = {
    rights: rightsGate(b.project, b.rights, now),
    facts: factGate(b.claims.filter((c) => b.storyboards.some((sb) => sb.scenes.some((s) => s.claimIds.includes(c.id)))), now),
    coverage: b.storyboards.map((sb) => claimCoverageGate(b.project, sb, b.claims)).find((g) => !g.ok) ?? { ok: true, hold: null, reasons: [] },
    affiliate: affiliateGate(b.product ?? null, b.claims, now),
  };
  return gates;
}

/**
 * PRODUCE stage: storyboard -> TTS -> render -> QA -> gates -> per-platform metadata ->
 * publication jobs. Never marks anything published; status ends READY_FOR_REVIEW or HOLD_*.
 */
export async function produceProject(ctx: Ctx, projectId: string, onStage?: (s: string) => Promise<void>): Promise<Record<string, unknown>> {
  const b = await loadProjectBundle(ctx, projectId);
  const { project, brief, plan } = b;
  const setStatus = async (status: Project["status"]) => {
    project.status = status;
    await ctx.store.saveProject(project);
    await onStage?.(status);
  };
  await setStatus("SCRIPT");
  const storyboards: Storyboard[] = [];
  for (const format of project.formats) {
    const sb = briefToStoryboard(brief, format, plan.family, b.claims, project.revision);
    await ctx.store.saveStoryboard(sb);
    storyboards.push(sb);
  }

  await setStatus("TTS");
  const tts = await pickTts(ctx.tts);
  const voice = tts.license();
  b.rights.voice = { engine: voice.engine, voice: voice.voice, license: voice.license, commercialUseOk: voice.commercialUseOk };
  await ctx.store.saveRights(b.rights);

  // each owner renders with ITS OWN versioned kit; never stamp Tủ Tò Mò on a game post
  const owner = project.gameId ? ({ kind: "game", id: project.gameId } as const) : ({ kind: "brand", id: project.brand } as const);
  const kitFile = await new BrandIdentityEngine(ctx.store).load(owner);
  if (kitFile) BrandIdentityEngine.assertOwnKit(kitFile, owner);
  const brand = kitFile ? toRenderKit(kitFile) : project.gameId === "machine-brigade" || plan.brand === "machine-brigade" ? MACHINE_BRIGADE_BRAND : TU_TO_MO_BRAND;
  const assetFiles: Record<string, string> = {};
  for (const a of b.rights.assets) {
    const local = ctx.store.p("projects", projectId, "assets", `${a.assetId}.png`);
    if (await fs.stat(local).catch(() => null)) assetFiles[a.assetId] = local;
  }

  const outputs: Record<string, unknown> = {};
  const qaResults: Record<string, boolean> = {};
  for (const sb of storyboards) {
    await setStatus("RENDER");
    ctx.log(`[${projectId}] dựng ${sb.format} (${sb.scenes.length} cảnh)`);
    const outDir = ctx.store.p("projects", projectId, "renders", sb.format);
    const render = await renderStoryboard({
      storyboard: sb,
      brand,
      tts,
      workDir: ctx.store.p("projects", projectId, "work", sb.format),
      outDir,
      assetFiles,
      badges: plan.badges,
      onProgress: (stage, detail) => ctx.log(`[${projectId}/${sb.format}] ${stage} ${detail}`),
    });
    await setStatus("QA");
    const spec = FORMAT_SPECS[sb.format as Format];
    const qa = await qaVideo({ projectId, format: sb.format, file: render.video, srt: render.srt, poster: render.poster, minSec: plan.minSecOverride ?? spec.minSec });
    if (render.chapters) qa.checks.push({ name: "chương YouTube hợp lệ", ok: render.chapters.ok, detail: render.chapters.ok ? render.chapters.text.replace(/\n/g, " | ") : render.chapters.reason! });
    qa.passed = qa.checks.every((c) => c.ok);
    await ctx.store.saveQa(qa);
    await writeJsonAtomic(path.join(outDir, "render-proof.json"), { ...render, ffprobe: qa.ffprobe, sha256: qa.sha256, renderedAt: nowIso(), tts: voice });
    qaResults[sb.format] = qa.passed;
    outputs[sb.format] = { video: render.video, durationSec: Math.round(render.durationSec * 10) / 10, qaPassed: qa.passed, encoder: render.encoder, chapters: render.chapters?.text ?? null };
    if (!qa.passed) {
      await setStatus("NEEDS_USER");
      const failed = qa.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
      await notify(ctx, `❌ QA video thất bại: ${project.title} (${sb.format})\n${failed.join("\n")}`, { dedupeKey: `qa:${projectId}:${sb.format}` });
      throw new FactoryError("QA_FAILED", "BLOCKED", `QA không đạt cho ${sb.format}: ${failed.join("; ")}`, { nextAction: "Xem qa-report và sửa cảnh/âm thanh rồi /retry" });
    }
  }

  // Ledger + metadata
  const gates = evaluateGates({ ...b, storyboards });
  const usedClaims = b.claims.filter((c) => storyboards.some((sb) => sb.scenes.some((s) => s.claimIds.includes(c.id))));
  const sources = [...new Map(usedClaims.flatMap((c) => c.sources).map((s) => [s.url, { title: `${s.publisher} — ${s.title}`, url: s.url }])).values()];
  const longSb = storyboards.find((s) => s.format === "long_16x9");
  const chapters = longSb ? ((outputs["long_16x9"] as any)?.chapters ?? null) : null;
  const meta = platformMetadata({
    title: brief.title,
    summary: plan.summary,
    hashtags: plan.hashtags,
    affiliateUrl: b.product?.affiliateLink?.url ?? null,
    disclosure: b.product?.disclosure ?? null,
    sources,
    credits: brief.credits,
    chapters,
    aiVoice: true,
  });
  await writeJsonAtomic(ctx.store.p("projects", projectId, "metadata.json"), meta);
  await writeJsonAtomic(ctx.store.p("projects", projectId, "gates.json"), { evaluatedAt: nowIso(), gates });
  await fs.writeFile(ctx.store.p("projects", projectId, "sources-ledger.md"), ledgerMarkdown(project, usedClaims, b.rights, gates), "utf8");

  const failing = Object.values(gates).filter((g) => !g.ok);
  await setStatus(failing.length ? failing[0].hold! : "READY_FOR_REVIEW");

  // Publication jobs: one per destination, idempotent by content revision.
  const jobs: string[] = [];
  for (const platform of plan.targets) {
    const format: Format = platform === "youtube_long" ? "long_16x9" : "short_9x16";
    if (!project.formats.includes(format)) continue;
    const key = idempotencyKey({ brand: project.brand, contentId: project.id, revision: project.revision, destination: platform });
    const { job } = await ctx.queue.enqueue({ kind: "PUBLISH", idempotencyKey: key, payload: { projectId, platform, format }, priority: 4 });
    jobs.push(job.id);
  }
  const short = outputs["short_9x16"] as any;
  const posterFile = ctx.store.p("projects", projectId, "renders", project.formats[0], `${project.formats[0]}.thumbnail.png`);
  await notify(
    ctx,
    [
      `🎬 Render xong: ${project.title}`,
      ...Object.entries(outputs).map(([f, o]: any) => `• ${f}: ${o.durationSec}s, QA ${o.qaPassed ? "đạt" : "lỗi"}`),
      `Trạng thái: ${project.status}`,
      ...failing.flatMap((g) => g.reasons.slice(0, 3).map((r) => `  ⛔ ${r}`)),
      project.mode === "demo" ? "Chế độ DEMO — không đăng thật." : "Duyệt bằng /approve <jobId> khi sẵn sàng.",
    ].join("\n"),
    { dedupeKey: `render:${projectId}:r${project.revision}`, photo: short ? undefined : posterFile, video: short?.video },
  );
  return { projectId, status: project.status, outputs, gates: Object.fromEntries(Object.entries(gates).map(([k, g]) => [k, g.ok ? "OK" : g.reasons])), publishJobs: jobs };
}

function ledgerMarkdown(project: Project, claims: Claim[], rights: RightsManifest, gates: Record<string, GateResult>): string {
  const L: string[] = [`# Sổ nguồn & quyền — ${project.title}`, "", `- Dự án: \`${project.id}\` (${project.contentType}, ${project.mode})`, `- Cập nhật: ${nowIso()}`, ""];
  L.push("## Claims", "");
  for (const c of claims) {
    L.push(`### ${c.id} — ${c.status}`, "", `> ${c.text}`, "", `Rủi ro: ${c.riskTier}; kiểm tra lần cuối: ${c.checkedAt ?? "chưa"}`, "");
    for (const s of c.sources) L.push(`- [${s.publisher}] ${s.title} — ${s.url} (truy xuất: ${s.fetchedAt ?? "CHƯA TRUY XUẤT"})${s.excerpt ? `\n  > ${s.excerpt}` : ""}`);
    L.push("");
  }
  L.push("## Quyền media", "", "| Asset | Sở hữu | License | Thương mại | Phái sinh | Trạng thái |", "|---|---|---|---|---|---|");
  for (const a of [...rights.assets, ...rights.music]) L.push(`| ${a.assetId} | ${a.ownershipType} | ${a.licenseId ?? "—"} | ${a.commercialUse ?? "?"} | ${a.adaptationAllowed ?? "?"} | ${a.status} |`);
  if (rights.voice) L.push("", `Giọng đọc: ${rights.voice.engine} / ${rights.voice.voice} — ${rights.voice.license}`);
  L.push("", "Nhạc nền: không dùng (chưa có nhạc có license thương mại được cấu hình).", "", "## Cổng kiểm duyệt", "");
  for (const [k, g] of Object.entries(gates)) L.push(`- **${k}**: ${g.ok ? "ĐẠT" : "GIỮ LẠI"}${g.reasons.length ? "\n" + g.reasons.map((r) => `  - ${r}`).join("\n") : ""}`);
  return L.join("\n") + "\n";
}
