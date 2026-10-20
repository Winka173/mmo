import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { Claim } from "@ttm/core";
import { detectEncoder, EspeakNgTts, ffprobe, FFMPEG, runProcess } from "@ttm/media";
import { googleLoopbackAuth, YOUTUBE_SCOPES } from "@ttm/platforms";
import { verifyClaim } from "@ttm/providers";
import { benchmarkEncoders, probeGpu } from "@ttm/media";
import { createBackup, freeDiskGb, listBackups, readDataVersion, restoreBackup, runMigrations, verifyDataDir } from "@ttm/storage";
import { buildContext, FIXTURES, type Ctx } from "./context.js";
import { runDaemon } from "./daemon.js";
import { seedFixtures } from "./fixtures.js";
import { processUntilIdle } from "./handlers.js";
import { buildDailyReport } from "./report.js";
import { buildTelegramHandlers } from "./telegram-handlers.js";

async function doctor(ctx: Ctx) {
  const rows: [string, boolean, string][] = [];
  const ff = await runProcess(FFMPEG, ["-version"]).catch(() => null);
  rows.push(["FFmpeg", !!ff && ff.code === 0, ff?.stdout.split("\n")[0] ?? "không tìm thấy — cài FFmpeg và thêm vào PATH"]);
  const enc = await detectEncoder();
  rows.push(["Bộ mã hóa video", true, enc.reason + (enc.gpu ? ` · VRAM ${enc.gpu.vramMb} MB · driver ${enc.gpu.driver}` : "")]);
  const tts = new EspeakNgTts();
  rows.push(["TTS tiếng Việt (eSpeak NG)", await tts.available(), (await tts.available()) ? "offline, miễn phí" : "chưa cài — xem RUNBOOK.md"]);
  rows.push(["Piper TTS", !!process.env.PIPER_MODEL, process.env.PIPER_MODEL ? process.env.PIPER_MODEL : "chưa cấu hình (tùy chọn, giọng tự nhiên hơn)"]);
  rows.push(["LLM runtime", !!process.env.LLM_BASE_URL, process.env.LLM_BASE_URL ? `${process.env.LLM_BASE_URL} (${process.env.LLM_MODEL})` : "chưa cấu hình → dùng kịch bản template xác định"]);
  rows.push(["Telegram bot", !!ctx.telegram, ctx.telegram ? "đã có token (đã mã hóa)" : "chưa cấu hình token"]);
  const s = await ctx.settings();
  rows.push(["Telegram allowlist", s.telegram.allowedChatIds.length > 0, s.telegram.allowedChatIds.length ? `${s.telegram.allowedChatIds.length} chat` : "trống — bot sẽ từ chối mọi lệnh"]);
  for (const [p, pub] of Object.entries(ctx.publishers)) {
    const c = await pub!.validateCapabilities();
    rows.push([`Kênh ${p}`, c.canPublish, c.canPublish ? `${c.accountName}` : c.blockers.join("; ")]);
  }
  const free = await freeDiskGb(ctx.store.root);
  rows.push(["Dung lượng trống", free === null || free >= s.minFreeDiskGb, free === null ? "không đo được" : `${free.toFixed(1)} GB`]);
  rows.push(["DATA_DIR", true, ctx.store.root]);
  rows.push(["Phiên bản dữ liệu", true, `v${await readDataVersion(ctx.store)}`]);
  const gpu = await probeGpu({ verifyNvenc: false });
  rows.push(["GPU (đo thực tế)", true, gpu.available ? `${gpu.name} · VRAM ${gpu.vramUsedMb}/${gpu.vramTotalMb} MB · ${gpu.temperatureC ?? "?"}°C · CUDA ${gpu.cuda ?? "?"}` : gpu.detail]);
  const v = await verifyDataDir(ctx.store, { hashMedia: false });
  rows.push(["Toàn vẹn dữ liệu", v.ok, `${v.scannedJson} JSON, ${v.issues.filter((i) => i.severity === "error").length} lỗi, ${v.issues.filter((i) => i.severity === "warn").length} cảnh báo (chi tiết: factory verify)`]);
  rows.push(["Secret backend", true, ctx.secrets.backend]);
  rows.push(["Đăng ra ngoài", true, s.externalPostingEnabled ? "BẬT" : "TẮT (mặc định an toàn)"]);
  for (const [name, ok, detail] of rows) console.log(`${ok ? "✅" : "⚠️ "} ${name.padEnd(28)} ${detail}`);
}

async function e2e(ctx: Ctx) {
  const t0 = Date.now();
  console.log(`DATA_DIR = ${ctx.store.root}`);
  const seed = await seedFixtures(ctx);
  console.log("Fixtures:", seed.projects.join(", "));
  console.log("Discovery:", JSON.stringify(seed.discovery, null, 2));
  for (const id of seed.projects) {
    const p = (await ctx.store.getProject(id))!;
    await ctx.queue.enqueue({ kind: "PRODUCE", idempotencyKey: `produce:${p.id}:r${p.revision}`, payload: { projectId: p.id }, usesGpu: true, priority: 3 });
  }
  const n = await processUntilIdle(ctx);
  console.log(`Đã xử lý ${n} job`);
  const summary: unknown[] = [];
  for (const id of seed.projects) {
    const p = (await ctx.store.getProject(id))!;
    for (const f of p.formats) {
      const qa = await ctx.store.getQa(id, f);
      summary.push({
        project: id,
        type: p.contentType,
        mode: p.mode,
        status: p.status,
        format: f,
        file: qa?.file,
        size: qa ? `${qa.ffprobe.width}x${qa.ffprobe.height}` : null,
        sec: qa ? Math.round(qa.ffprobe.durationSec * 10) / 10 : null,
        codec: qa ? `${qa.ffprobe.videoCodec}/${qa.ffprobe.audioCodec}` : null,
        qa: qa?.passed,
        publications: (await ctx.store.getPublications(id)).map((x) => `${x.platform}:${x.state}`).join(" "),
      });
    }
  }
  console.table(summary);
  const r = await buildDailyReport(ctx);
  console.log("\n" + r.text);
  console.log(`\nBáo cáo: ${r.files.join(", ")}`);
  console.log(`Hàng đợi: ${JSON.stringify(await ctx.queue.counts())}`);
  console.log(`Tổng thời gian: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const bad = summary.filter((s: any) => !s.qa);
  if (bad.length) {
    console.error("Có video không đạt QA:", bad);
    process.exitCode = 1;
  }
}

async function factcheck(ctx: Ctx, projectId: string) {
  const claims = await ctx.store.getClaims(projectId);
  const evidence = JSON.parse(await fs.readFile(path.join(FIXTURES, "fact-venus", "evidence.json"), "utf8"));
  const out = [];
  for (const c of claims) {
    const r = await verifyClaim(Claim.parse(c), evidence[c.id] ?? {});
    out.push(r.claim);
    console.log(`${c.id}: ${c.status} -> ${r.claim.status}`);
    for (const l of r.log) console.log(`   ${l.ok ? "✅" : "⛔"} ${l.url} — ${l.detail}`);
  }
  await ctx.store.saveClaims(projectId, out);
  await ctx.store.audit({ actor: "cli", action: "factcheck.run", subject: projectId, detail: { verified: out.filter((c) => c.status === "VERIFIED").length } });
}

async function readSecretFromStdin(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const v = await rl.question(prompt);
  rl.close();
  return v.trim();
}

async function main() {
  const [cmd = "help", ...args] = process.argv.slice(2);
  const ctx = await buildContext();
  const h = buildTelegramHandlers(ctx);
  switch (cmd) {
    case "run":
      return runDaemon(ctx);
    case "once": {
      await ctx.queue.recover();
      console.log(`Đã xử lý ${await processUntilIdle(ctx)} job`);
      await ctx.outbox.flush(ctx.telegram);
      return;
    }
    case "e2e":
      return e2e(ctx);
    case "doctor":
      return doctor(ctx);
    case "status":
      return console.log(await h.status());
    case "queue":
      return console.log(await h.queue());
    case "report": {
      const r = await buildDailyReport(ctx, args[0]);
      return console.log(r.text + `\n\n${r.files.join("\n")}`);
    }
    case "approve":
      return console.log(await h.approve(args[0], "cli"));
    case "reject":
      return console.log(await h.reject(args[0], "cli"));
    case "retry":
      return console.log(await h.retry(args[0], "cli"));
    case "pause":
      return console.log(await h.pause("cli"));
    case "resume":
      return console.log(await h.resume("cli"));
    case "kill-switch": {
      const on = args[0] !== "off";
      await ctx.store.updateSettings((s) => ({ ...s, killSwitch: on }), "cli");
      return console.log(`Kill switch: ${on ? "BẬT" : "tắt"}`);
    }
    case "backup": {
      const withSecrets = args.includes("--with-secrets");
      const label = args.find((a) => !a.startsWith("--"));
      const secretsPassphrase = withSecrets ? await readSecretFromStdin("Mật khẩu mã hóa bản sao lưu secrets: ") : undefined;
      return console.log(await createBackup(ctx.store, { label, secretsPassphrase }));
    }
    case "backups":
      return console.log((await listBackups(ctx.store)).join("\n"));
    case "restore": {
      const dryRun = args.includes("--dry-run");
      const name = args.find((a) => !a.startsWith("--"));
      if (!name) return console.log("Cú pháp: restore <tên-bản-sao-lưu> [--dry-run] [--with-secrets]");
      const secretsPassphrase = args.includes("--with-secrets") ? await readSecretFromStdin("Mật khẩu giải mã secrets: ") : undefined;
      const r = await restoreBackup(ctx.store, name, { dryRun, secretsPassphrase });
      return console.log(JSON.stringify(r, null, 2));
    }
    case "verify": {
      const r = await verifyDataDir(ctx.store, { fix: args.includes("--fix") });
      for (const i of r.issues) console.log(`${i.severity === "error" ? "⛔" : "⚠️ "} ${i.file}: ${i.problem}${i.fixed ? " (đã sửa)" : ""}`);
      console.log(`Đã quét ${r.scannedJson} JSON, ${r.scannedJsonl} JSONL, ${r.mediaChecked} media — ${r.ok ? "KHÔNG có lỗi nghiêm trọng" : "CÓ lỗi"}`);
      if (!r.ok) process.exitCode = 1;
      return;
    }
    case "migrate":
      return console.log(JSON.stringify(await runMigrations(ctx.store, { dryRun: args.includes("--dry-run"), backup: (label) => createBackup(ctx.store, { label }) }), null, 2));
    case "gpu": {
      const p = await probeGpu();
      console.log(JSON.stringify(p, null, 2));
      return console.log(JSON.stringify(await benchmarkEncoders({ includeNvenc: p.nvencVerified }), null, 2));
    }
    case "factcheck":
      return factcheck(ctx, args[0]);
    case "probe":
      return console.log(await ffprobe(args[0]));
    case "secrets": {
      if (args[0] !== "set" || !args[1]) return console.log("Cú pháp: secrets set <tên>  (giá trị nhập từ bàn phím, không qua tham số dòng lệnh)");
      await ctx.secrets.set(args[1], await readSecretFromStdin(`Nhập giá trị cho ${args[1]}: `));
      return console.log(`Đã lưu ${args[1]} (${ctx.secrets.backend}).`);
    }
    case "telegram-allow": {
      await ctx.store.updateSettings((s) => ({ ...s, telegram: { ...s.telegram, enabled: true, allowedChatIds: [...new Set([...s.telegram.allowedChatIds, args[0]])] } }), "cli");
      return console.log(`Đã thêm chat ${args[0]} vào allowlist.`);
    }
    case "youtube-auth": {
      const clientId = await ctx.secrets.get("youtube.clientId");
      const clientSecret = await ctx.secrets.get("youtube.clientSecret");
      if (!clientId || !clientSecret) return console.log("Trước tiên: secrets set youtube.clientId và secrets set youtube.clientSecret (OAuth client loại Desktop app).");
      const r = await googleLoopbackAuth({ clientId, clientSecret, scopes: YOUTUBE_SCOPES, onUrl: (u) => console.log(`Mở URL này trong trình duyệt để cấp quyền:\n${u}`) });
      await ctx.secrets.set("youtube.refreshToken", r.refreshToken);
      return console.log(`Đã kết nối YouTube. Scope: ${r.scope}`);
    }
    default:
      console.log(
        [
          "Tủ Tò Mò worker",
          "  run            chạy worker nền (scheduler + hàng đợi + Telegram)",
          "  once           xử lý hết job đang chờ rồi thoát",
          "  e2e            seed fixture hợp lệ + dựng video thật + báo cáo",
          "  doctor         kiểm tra môi trường (FFmpeg, GPU, TTS, kênh)",
          "  status | queue | report [YYYY-MM-DD]",
          "  approve|reject|retry <jobId>, pause, resume, kill-switch [on|off]",
          "  backup [nhãn] [--with-secrets] | backups | restore <tên> [--dry-run] [--with-secrets]",
          "  verify [--fix]          kiểm tra toàn vẹn JSON/JSONL/media (factory verify)",
          "  migrate [--dry-run]     nâng cấp schema thư mục dữ liệu",
          "  gpu                     đo GPU/VRAM/nhiệt độ + benchmark encoder thực tế",
          "  factcheck <projectId>   truy xuất nguồn thật để kiểm chứng claim",
          "  secrets set <tên>       lưu secret (DPAPI trên Windows)",
          "  telegram-allow <chatId> | youtube-auth",
        ].join("\n"),
      );
  }
}

main().catch((e) => {
  console.error(`Lỗi: ${e?.message ?? e}`);
  process.exitCode = 1;
});
