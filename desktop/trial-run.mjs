// End-to-end trial run through the packaged app: one-click model setup (reusing the local model store), one short
// Vietnamese video from labelled FIXTURE media (not real gameplay), Library check, evidence copy. Isolated data folder.
// Local models only; GPU work waits on the shared OS GPU lease; nothing is posted and no message is sent.
// Usage: node desktop/trial-run.mjs [--fast-cpu-after-min=N]   (N: minutes to wait for the quality model's RAM before
// switching this trial's config to the fast model on CPU, which the router flags reviewRequired)
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';

const root = process.cwd(), stamp = new Date().toISOString().replace(/[:.]/g, '-'), trial = path.join(root, '.local/trial', stamp), cfg = path.join(trial, 'cfg'), dataDir = path.join(trial, 'data');
const exe = process.env.ACS_SMOKE_EXE ?? path.join(root, 'dist/windows/AUTONOMOUS CREATIVE STUDIO.exe'), evidenceDir = path.join(root, 'docs/evidence/trial-2026-11-02');
const fastAfterMin = Number((process.argv.find((a) => a.startsWith('--fast-cpu-after-min=')) ?? '=20').split('=')[1]);
const log = []; const note = (m, extra) => { const row = { at: new Date().toISOString(), m, ...(extra ? { extra } : {}) }; log.push(row); console.log(row.at.slice(11, 19), m, extra ? JSON.stringify(extra).slice(0, 300) : ''); };
const free = () => ({ freeRamGb: +(os.freemem() / 2 ** 30).toFixed(1) });
await fs.mkdir(path.join(dataDir, 'config'), { recursive: true }); await fs.mkdir(evidenceDir, { recursive: true });
await fs.writeFile(path.join(dataDir, 'config/settings.json'), JSON.stringify({ schemaVersion: 1, paused: false, externalPostingEnabled: false }));
const probe = createServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise((r) => probe.close(r));
const child = spawn(exe, [], { env: { ...process.env, ACS_CONFIG_DIR: cfg, ACS_DATA: dataDir, ACS_SETUP_ROOT: root, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` }, windowsHide: true, stdio: 'ignore' });
let browser, result = { status: 'FAIL' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let status; for (let i = 0; i < 120; i++) { status = await fs.readFile(path.join(cfg, 'desktop-status.json'), 'utf8').then(JSON.parse, () => null); if (status?.status === 'READY') break; await sleep(500); }
  if (status?.status !== 'READY') throw new Error('backend not ready');
  const base = `http://127.0.0.1:${status.port}`;
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page; for (let i = 0; i < 60; i++) { page = browser.contexts()[0].pages().find((p) => p.url().startsWith(base)); if (page) break; await sleep(500); }
  await page.setViewportSize({ width: 1440, height: 900 });
  const api = (body) => page.evaluate(async (b) => { const r = await fetch('/api/studio', b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : { cache: 'no-store' }); return { status: r.status, json: await r.json().catch(() => null) }; }, body ?? null);
  note('app ready', { base, ...free() });

  // 1. One-click AI setup from the Models page (reuses the existing local model store under ACS_SETUP_ROOT)
  await page.goto(`${base}/studio/models`); const auto = page.getByLabel('Cài đặt AI tự động'); await auto.waitFor({ timeout: 30000 });
  note('setup folder', { folder: await auto.locator('code').innerText() });
  const button = auto.getByRole('button', { name: /Cài đặt tự động/ });
  if (await button.count()) { await button.click(); note('clicked one-click install'); }
  const need = ['llmModel', 'llmQualityModel', 'ttsViModel', 'ttsEnModel', 'asrModel', 'vadModel', 'embeddingModel'];
  const retried = new Set();
  for (let i = 0; ; i++) {
    const { json } = await api(); const c = json.config, missing = need.filter((k) => !c[k]);
    const setups = (json.setups ?? []).map((s) => `${s.profile}:${s.state}`).join(' ');
    if (i % 6 === 0) note('setup progress', { missing, setups });
    if (!missing.length) { note('all selected AI parts installed and applied', { setups }); break; }
    const failed = (json.setups ?? []).filter((s) => s.state === 'failed' && !retried.has(s.id));
    if (failed.length) {
      // The owner would press the install button again; allow one retry per failed setup, then stop.
      if (failed.some((s) => (json.setups ?? []).filter((x) => x.profile === s.profile && x.state === 'failed').length > 1)) throw new Error('setup failed twice: ' + JSON.stringify(failed.map((s) => ({ p: s.profile, e: s.error }))));
      failed.forEach((s) => retried.add(s.id)); note('setup failed once; pressing the install button again', failed.map((s) => ({ p: s.profile, e: s.error })));
      await page.reload(); await auto.waitFor({ timeout: 30000 }); await auto.getByRole('button', { name: /Cài đặt tự động/ }).click();
    }
    if (i > 360) throw new Error('setup timeout');
    await sleep(10000);
  }
  // 2. Local tools: use the app's own tool discovery; fall back to the repo's FFmpeg copy if not on PATH
  const tools = await api({ action: 'discover-tools', root }); note('discover-tools', tools.json);
  let { json: ws } = await api();
  if (!/ffmpeg/i.test(ws.config.ffmpeg) || ws.config.ffmpeg === 'ffmpeg') { const cfgNew = { ...ws.config, ffmpeg: path.join(root, '.local/tools/ffmpeg.exe'), ffprobe: path.join(root, '.local/tools/ffprobe.exe') }; note('save-config ffmpeg paths', await api({ action: 'save-config', value: cfgNew }).then((r) => r.status)); }
  // 3. The labelled fixture production, started with the Autopilots page "Test run" button
  const brief = 'FIXTURE (không phải gameplay thật): "Lane Keeper" là game thủ thành 3 làn đường do nhóm phát triển tự làm. Người chơi đặt tháp trên 3 làn để chặn quái. Có 2 loại tháp: tháp cung bắn nhanh và tháp phép làm chậm. Mỗi màn có 5 đợt quái, đợt cuối có trùm. Game đang trong giai đoạn thử nghiệm nội bộ, chưa có ngày phát hành và chưa có giá.';
  const now = new Date().toISOString();
  const saved = await api({ action: 'save-autopilot', value: { name: 'Trial — Lane Keeper (fixture)', family: 'game', brief, sourceFolder: path.join(root, '.local/fixture-media/trial'), rights: 'AUTHORIZED_REUSE', rightsEvidence: 'Synthetic FFmpeg fixture clips generated for this trial; labelled NOT REAL GAMEPLAY on screen', languages: ['vi-VN'], audience: 'Người chơi game chiến thuật trên điện thoại', tone: 'clear', cadenceDays: 7, durationSec: 20, format: 'short_9x16', mode: 'REVIEW_REQUIRED', enabled: false, step: 7, targets: [] } });
  if (saved.status !== 200) throw new Error('save-autopilot ' + JSON.stringify(saved.json)); const pilot = saved.json; note('autopilot saved', { id: pilot.id });
  await page.goto(`${base}/studio/autopilots`); const card = page.locator('section.acs-panel').filter({ hasText: 'Trial — Lane Keeper (fixture)' });
  await card.getByRole('button', { name: 'Chạy thử' }).click(); note('clicked Test run');
  let run; for (let i = 0; i < 30; i++) { ({ json: ws } = await api()); run = ws.runs.find((r) => r.autopilotId === pilot.id && !r.planning); if (run) break; await sleep(1000); }
  if (!run) throw new Error('run not created'); note('run queued', { id: run.id });
  // 4. Watch real progress. If the quality model cannot get RAM for too long, switch this trial to the fast model on CPU.
  const t0 = Date.now(); let switched = false, lastSig = '';
  for (;;) {
    ({ json: ws } = await api()); run = ws.runs.find((r) => r.id === run.id) ?? run;
    const sig = run.state + ' ' + run.stages.map((s) => `${s.id}:${s.state}`).join(',');
    if (sig !== lastSig) { note('run', { state: run.state, stages: run.stages.filter((s) => s.state !== 'queued').map((s) => `${s.id}:${s.state}${s.note ? ' — ' + s.note.slice(0, 120) : ''}`), error: run.error, ...free() }); lastSig = sig; }
    if (['ready', 'failed', 'cancelled', 'needs_input'].includes(run.state)) break;
    const jobs = await page.evaluate(() => fetch('/api/studio', { cache: 'no-store' }).then((r) => r.json()).then((j) => j.counts));
    if (!switched && fastAfterMin >= 0 && Date.now() - t0 > fastAfterMin * 60000 && run.stages.find((s) => s.id === 'script')?.state !== 'passed' && /RAM_BUSY|GPU_BUSY/.test(String(run.error ?? '') + JSON.stringify(run.stages))) {
      const c = ws.config; const next = { ...c, llmQualityModel: '', llmQualityModelDigest: '', llmDevice: 'cpu' };
      // A run keeps the config it was queued with, so cancel it, change the config, and press Test run again.
      note('cancel waiting run', { status: (await api({ action: 'control-run', id: run.id, command: 'cancel' })).status });
      note('quality model still waiting for RAM/GPU; trial switches to fast model on CPU (router flags reviewRequired)', { status: (await api({ action: 'save-config', value: next })).status, jobs, ...free() });
      switched = true; const old = run.id;
      await page.goto(`${base}/studio/autopilots`); await page.locator('section.acs-panel').filter({ hasText: 'Trial — Lane Keeper (fixture)' }).getByRole('button', { name: 'Chạy thử' }).click();
      for (let i = 0; i < 30; i++) { ({ json: ws } = await api()); const r = ws.runs.find((x) => x.autopilotId === pilot.id && !x.planning && x.id !== old && x.state !== 'cancelled'); if (r) { run = r; break; } await sleep(1000); }
      note('new run queued with fast CPU config', { id: run.id });
    }
    if (Date.now() - t0 > 150 * 60000) throw new Error('production timeout');
    await sleep(15000);
  }
  // 5. Library shows the artifact
  await page.goto(`${base}/studio/library`); const libCard = page.locator('section.acs-panel').filter({ hasText: 'Trial — Lane Keeper (fixture)' }).first();
  const inLibrary = await libCard.waitFor({ timeout: 20000 }).then(() => true, () => false); await page.screenshot({ path: path.join(evidenceDir, 'library.png'), fullPage: false });
  await page.goto(`${base}/studio/production?id=${run.id}`); await page.waitForTimeout(3000); await page.screenshot({ path: path.join(evidenceDir, 'production.png'), fullPage: true });
  const dir = path.join(dataDir, 'studio/artifacts', run.id), copied = [];
  for (const f of run.outputs) { const src = path.join(dir, f); const st = await fs.stat(src).catch(() => null); if (st?.isFile() && st.size < 40 * 2 ** 20 && !/\.wav$/i.test(f)) { await fs.copyFile(src, path.join(evidenceDir, f)); copied.push(f); } }
  result = { status: run.state === 'ready' && inLibrary ? 'PASS' : 'FAIL', runId: run.id, state: run.state, error: run.error, switchedToFastCpu: switched, inLibrary, outputs: run.outputs, copied, stages: run.stages, config: { llmModel: ws.config.llmModel, llmDevice: ws.config.llmDevice, llmQualityModel: ws.config.llmQualityModel, ttsViModel: ws.config.ttsViModel, voiceVi: ws.config.voiceVi, asrModel: ws.config.asrModel, ffmpeg: ws.config.ffmpeg } };
} catch (error) { note('trial error', { message: error.message }); result.error = error.message; }
finally {
  await browser?.close().catch(() => {});
  if (child.pid && child.exitCode === null) await new Promise((resolve) => { const stop = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); stop.on('close', resolve); });
}
await fs.writeFile(path.join(evidenceDir, 'trial-run.json'), JSON.stringify({ ...result, exe, trialDataDir: trial, fixture: 'Synthetic FFmpeg clips labelled NOT REAL GAMEPLAY; no owner gameplay exists', log }, null, 2));
console.log(JSON.stringify({ status: result.status, runId: result.runId, state: result.state }));
process.exit(result.status === 'PASS' ? 0 : 1);
