// Packaged-app check of the "fewest inputs" UI rules: one-click AI setup, readiness card, resource chips with a popover
// nothing can cover, support report, automatic video title, and the operating pages (Autopilots, Production, Review,
// Planner, Channels, Library) in VI and EN with seeded fixture data. Isolated data; starts no production and no setup job.
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';

const root = process.cwd(), cfg = path.join(root, '.local/ui-rules-check', randomUUID()), exe = process.env.ACS_SMOKE_EXE ?? path.join(root, 'dist/windows/AUTONOMOUS CREATIVE STUDIO.exe');
const dataDir = path.join(cfg, 'data');
await fs.mkdir(path.join(dataDir, 'config'), { recursive: true });
await fs.writeFile(path.join(dataDir, 'config/settings.json'), JSON.stringify({ schemaVersion: 1, paused: true, externalPostingEnabled: false }));
const probe = createServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise((r) => probe.close(r));
const child = spawn(exe, [], { env: { ...process.env, ACS_CONFIG_DIR: cfg, ACS_DATA: dataDir, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` }, windowsHide: true, stdio: 'ignore' });
const checks = []; const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 200) }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + String(detail).slice(0, 140) : '')); };
let browser;
try {
  let status;
  for (let i = 0; i < 120; i++) { status = await fs.readFile(path.join(cfg, 'desktop-status.json'), 'utf8').then(JSON.parse, () => null); if (status?.status === 'READY') break; await new Promise((r) => setTimeout(r, 500)); }
  if (status?.status !== 'READY') throw new Error('backend not ready');
  const base = `http://127.0.0.1:${status.port}`;
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page; for (let i = 0; i < 60; i++) { page = browser.contexts()[0].pages().find((p) => p.url().startsWith(base)); if (page) break; await new Promise((r) => setTimeout(r, 500)); }
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Overview: a readiness card with one action, not a hero
  await page.goto(`${base}/studio/overview`); await page.getByRole('heading', { name: 'Không gian sáng tạo của bạn' }).waitFor({ timeout: 30000 });
  const card = page.getByLabel('Sẵn sàng sản xuất');
  await card.waitFor({ timeout: 15000 });
  check('Overview shows the readiness card with a single install-or-create action', (await card.getByRole('link').count()) === 1, (await card.innerText()).replace(/\s+/g, ' ').slice(0, 120));

  // 2. Resource chips: RAM, Disk, VRAM share one style; the popover is above everything and clickable
  const chips = page.locator('.acs-chips .acs-chip');
  await chips.first().waitFor({ timeout: 20000 });
  check('RAM, Disk and VRAM chips are present', (await chips.count()) >= 3, `${await chips.count()} chips`);
  const vram = page.getByRole('button', { name: 'Trạng thái GPU' });
  await vram.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 5000 });
  const box = await dialog.boundingBox();
  const top = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return !!el?.closest('.acs-popover'); }, [box.x + box.width / 2, box.y + box.height / 2]);
  check('VRAM popover is on top (nothing covers it) and shows live numbers', top && /GB VRAM/.test(await dialog.innerText()), (await dialog.innerText()).replace(/\s+/g, ' ').slice(0, 100));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Trạng thái RAM' }).click(); await dialog.waitFor({ timeout: 5000 });
  check('RAM chip opens its own popover', /GB/.test(await dialog.innerText()));
  await page.keyboard.press('Escape');

  // 3. Models: one-click setup with an automatic folder, nothing typed
  await page.goto(`${base}/studio/models`);
  const auto = page.getByLabel('Cài đặt AI tự động');
  await auto.waitFor({ timeout: 30000 });
  const folder = await auto.locator('code').innerText();
  check('Models: automatic setup with an automatic folder (no typing needed)', folder.length > 3 && !(await auto.getByRole('textbox').count()), folder);
  check('Models: one install button, quality model and voices listed', (await auto.getByRole('button', { name: /Cài đặt tự động/ }).count()) === 1 && /Gemma 4 31B/.test(await auto.innerText()) && /VieNeu/.test(await auto.innerText()));

  // 4. Support report from Settings
  await page.goto(`${base}/studio/settings`);
  await page.getByRole('button', { name: 'Xuất log đầy đủ' }).click();
  await page.getByText(/Đã lưu/).waitFor({ timeout: 30000 });
  const saved = await page.locator('section[aria-label="Báo lỗi"] code').innerText();
  const zip = await page.evaluate(async (name) => { const r = await fetch(`/api/support-report?name=${encodeURIComponent(name)}`); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, bytes: b.length, magic: String.fromCharCode(b[0], b[1]) }; }, path.basename(saved));
  check('Support report is created and downloads as a zip', zip.status === 200 && zip.magic === 'PK' && zip.bytes > 200, JSON.stringify(zip));

  // 5. Create: the title fills itself from the media folder (or the brief) instead of being typed
  await page.goto(`${base}/studio/create`);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.getByLabel('Language').selectOption('en')]);
  const title = page.getByLabel('Video title', { exact: true });
  await title.waitFor({ timeout: 30000 });
  await page.getByLabel('Local media folder').fill('C:/clips/Tower Defense Guide');
  await page.waitForTimeout(600);
  check('Create: video title is filled automatically from the media folder', (await title.inputValue()) === 'Tower Defense Guide', await title.inputValue());

  // 6-11. Operating pages with seeded fixture data (worker stays paused: nothing is produced, no GPU)
  const fixtureDir = path.join(root, '.local/fixture-media/review');
  await page.evaluate((l) => { document.cookie = `acs_locale=${l}; Path=/; SameSite=Strict`; }, 'vi');
  await page.goto(`${base}/studio/overview`);
  const seed = await page.evaluate(async (folder) => {
    const post = (b) => fetch('/api/studio', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));
    const a = await post({ action: 'save-autopilot', value: { name: 'UI check fixture', family: 'game', brief: 'Labelled fixture brief: a tower defense game with three lanes.', sourceFolder: folder, rights: 'AUTHORIZED_REUSE', rightsEvidence: 'Owner-made fixture media', languages: ['vi-VN'], cadenceDays: 2, durationSec: 30, format: 'short_9x16', mode: 'REVIEW_REQUIRED', enabled: false, step: 7, targets: [] } });
    const r = await post({ action: 'run', id: a.j?.id });
    return { autopilot: a.s, run: r.s };
  }, fixtureDir);
  check('Seed: fixture autopilot and queued run created through the API', seed.autopilot === 200 && seed.run === 200, JSON.stringify(seed));
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(`${base}/studio/autopilots`); await page.getByText('UI check fixture').first().waitFor({ timeout: 20000 });
  const pilots = await page.locator('main').innerText();
  check('Autopilots: card states and actions are in Vietnamese', /Tạm dừng \/ Nháp/.test(pilots) && /Kích hoạt/.test(pilots) && !/\bActivate\b|\bdays\b/.test(pilots), pilots.replace(/\s+/g, ' ').slice(200, 360));
  await page.goto(`${base}/studio/production`); await page.getByRole('tab', { name: 'Xuất & Đăng' }).waitFor({ timeout: 20000 });
  const tabsFit = await page.evaluate(() => { const tabs = [...document.querySelectorAll('.acs-tabs [role=tab]')], panel = tabs[0]?.closest('.acs-panel')?.getBoundingClientRect(); return tabs.length === 8 && tabs.every((t) => { const r = t.getBoundingClientRect(); return r.right <= panel.right + 1 && r.width > 0; }); });
  const prod = await page.locator('main').innerText();
  check('Production: all eight tabs visible at the 900 px minimum window width', tabsFit);
  check('Production: run state, stage names and controls are translated', /Đang chờ/.test(prod) && /Kịch bản/.test(prod) && /Hủy bản này/.test(prod) && !/\bqueued\b|\bResume\b|\bcancel\b/.test(prod), prod.replace(/\s+/g, ' ').slice(0, 160));
  await page.getByRole('tab', { name: 'Lời đọc' }).click();
  check('Production: tab switch works', (await page.getByRole('tab', { name: 'Lời đọc' }).getAttribute('aria-selected')) === 'true');
  await page.goto(`${base}/studio/review`); await page.getByText('Chưa có sản phẩm cần duyệt.').waitFor({ timeout: 20000 });
  check('Review: empty inbox explains where queued work is', await page.getByRole('link', { name: 'Xem Sản xuất →' }).isVisible());
  await page.goto(`${base}/studio/planner`); await page.getByLabel('Số ngày mô phỏng').waitFor({ timeout: 20000 });
  const simulated = page.waitForResponse((r) => r.url().endsWith('/api/studio') && r.request().method() === 'POST', { timeout: 15000 });
  await page.getByLabel('Số ngày mô phỏng').selectOption('7');
  const simStatus = (await simulated).status(); const noActive = await page.getByText(/Chưa có Autopilot nào đang bật/).waitFor({ timeout: 15000 }).then(() => true, () => false);
  check('Planner: changing the window re-simulates and labels are translated', simStatus === 200 && /7 ngày/.test(await page.getByLabel('Số ngày mô phỏng').innerText()) && noActive, `status ${simStatus}, no-active message ${noActive}`);
  await page.goto(`${base}/studio/channels`); await page.getByRole('heading', { name: 'Đăng một phiên bản đã duyệt' }).waitFor({ timeout: 20000 });
  const channels = await page.locator('main').innerText();
  check('Channels: no raw field names or contradictory sign-in text', !/clientId|clientSecret|refreshToken|chưa có trình đăng nhập/.test(channels));
  // 12-15. Accounts & Keys: the only place for credentials; write-only values; channels for every platform
  await page.getByLabel('Tên kênh').fill('UI check Facebook Page'); await page.getByLabel('Nền tảng').selectOption('facebook_reels');
  await page.getByLabel('Facebook Page ID (số)').fill('123456789012345'); await page.getByRole('button', { name: 'Thêm kênh (chưa bật)' }).click();
  await page.getByRole('heading', { name: 'UI check Facebook Page' }).waitFor({ timeout: 15000 });
  check('Channels: a Facebook Page Reels channel can be added and shows "needs account"', /Facebook Page Reels · 123456789012345 · Đã tắt · Chờ tài khoản/.test(await page.locator('main').innerText()));
  const build = page.getByLabel('Xây kênh'); await build.getByLabel('Mục tiêu kênh').fill('Help new players of the fixture game');
  await build.getByRole('textbox', { name: /Pillar \| Series/ }).fill('Guides | Weekly tip | game | 2 | Tower placement basics; Slow vs fast towers');
  await build.getByRole('button', { name: 'Lưu chiến lược' }).click(); await build.getByRole('button', { name: 'Đề xuất kế hoạch tuần tới' }).click();
  await build.getByText('Chờ bạn duyệt').first().waitFor({ timeout: 15000 }); await build.getByRole('button', { name: 'Duyệt', exact: true }).first().click();
  const draft = await build.getByRole('link', { name: 'Mở bản nháp →' }).waitFor({ timeout: 15000 }).then(() => true, () => false);
  check('Channel building: strategy, weekly plan from the backlog, owner approval creates a disabled draft Autopilot', draft && (await build.getByText('Chờ bạn duyệt').count()) === 1 && /Chưa đủ dữ liệu/.test(await build.innerText()));
  const stray = {};
  for (const view of ['channels', 'telegram', 'production', 'models']) { await page.goto(`${base}/studio/${view}`); await page.waitForTimeout(2000); stray[view] = await page.locator('main input[type=password]').count(); }
  check('No credential inputs outside Settings › Accounts & Keys', Object.values(stray).every((n) => n === 0), JSON.stringify(stray));
  await page.goto(`${base}/studio/settings`); const accounts = page.getByLabel('Tài khoản & Khóa', { exact: true }); await accounts.locator('[data-entry="telegram-bot"]').waitFor({ timeout: 20000 });
  const states = await accounts.locator('[data-entry] [data-state], [data-channel] [data-state]').evaluateAll((els) => els.map((e) => e.getAttribute('data-state')));
  const groups = await accounts.locator('.acs-account-group > h3').allInnerTexts();
  check('Accounts & Keys lists YouTube, Meta, TikTok, Telegram and affiliate with a status each, all "needs account" at first', ['YouTube', 'Facebook & Instagram (Meta)', 'TikTok', 'Telegram', 'Affiliate'].every((g) => groups.includes(g)) && states.length >= 7 && states.every((x) => x === 'not_set'), `${groups.join(', ')} | ${states.join(',')}`);
  const fakeBot = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const bot = accounts.locator('[data-entry="telegram-bot"]');
  await bot.getByLabel('Bot token').fill(fakeBot); await bot.getByRole('button', { name: 'Lưu' }).click();
  await bot.locator('[data-state="set"]').waitFor({ timeout: 20000 });
  const leaked = (await page.content()).includes(fakeBot) || (await page.evaluate(() => fetch('/api/studio/accounts').then((r) => r.text()))).includes('AAAAAAAAAAAAAAAAAAAA');
  check('Saving a key stores it write-only: status "saved, not tested", the value is never shown again', !leaked && (await bot.getByLabel('Bot token').inputValue()) === '' && /đã lưu/.test(await bot.getByLabel('Bot token').getAttribute('placeholder')));
  page.once('dialog', (d) => d.accept()); await bot.getByRole('button', { name: 'Xóa' }).click(); await bot.locator('[data-state="not_set"]').waitFor({ timeout: 20000 });
  check('Remove returns the entry to "needs account"; Test connection is offered only when a value exists', (await bot.getByRole('button', { name: 'Kiểm tra kết nối' }).isDisabled()));
  const fbAccount = accounts.locator('[data-channel]').filter({ hasText: 'UI check Facebook Page' });
  check('The Facebook channel appears under Meta with its Page token field', (await fbAccount.getByLabel('Page access token').count()) === 1);
  await page.goto(`${base}/studio/library`); await page.getByRole('button', { name: 'Dựng / làm mới chỉ mục' }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Dựng / làm mới chỉ mục' }).click();
  await page.locator('main [role=status], main [role=alert]').first().waitFor({ timeout: 15000 });
  check('Library: index button gives visible feedback (status or error)', true, await page.locator('main [role=status], main [role=alert]').first().innerText());
  await page.evaluate((l) => { document.cookie = `acs_locale=${l}; Path=/; SameSite=Strict`; }, 'en');
  const leaks = [];
  for (const view of ['channels', 'planner', 'review', 'autopilots', 'production', 'library']) { await page.goto(`${base}/studio/${view}`); await page.waitForTimeout(2500); const lines = (await page.locator('main').innerText()).split('\n').filter((l) => /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(l)); if (lines.length) leaks.push(`${view}: ${lines[0]}`); }
  check('English: the six operating pages show no Vietnamese text', leaks.length === 0, leaks.join(' | '));
  await page.evaluate((l) => { document.cookie = `acs_locale=${l}; Path=/; SameSite=Strict`; }, 'vi');
  const legacy = {};
  for (const [route, heading] of [['/experiments', 'Thử nghiệm A/B'], ['/budget', 'Ngân sách & chi phí'], ['/planner', '']]) { const r = await page.goto(`${base}${route}`); legacy[route] = r?.status(); if (heading) legacy[route] += (await page.getByRole('heading', { name: heading }).isVisible().catch(() => false)) ? ' ok' : ' no-heading'; }
  check('Legacy A/B, budget and planner pages render from stored data (HTTP 200)', Object.values(legacy).every((v) => String(v).startsWith('200') && !String(v).includes('no-heading')), JSON.stringify(legacy));
  check('No page errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: path.join(cfg, 'create.png') });
} catch (error) {
  check('check run', false, error.message);
} finally {
  await browser?.close().catch(() => {});
  if (child.pid && child.exitCode === null) await new Promise((resolve) => { const stop = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); stop.on('close', resolve); });
}
const status = checks.every((c) => c.ok) ? 'PASS' : 'FAIL';
await fs.writeFile(path.join(root, 'docs/evidence/acs-ui-rules-check.json'), JSON.stringify({ status, exe, at: new Date().toISOString(), checks }, null, 2));
console.log(JSON.stringify({ status }));
process.exit(status === 'PASS' ? 0 : 1);
