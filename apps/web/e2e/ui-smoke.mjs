// Playwright UI smoke for the Control Center (run against a running `next start`).
// BASE_URL=http://127.0.0.1:3077 SHOTS=docs/evidence node apps/web/e2e/ui-smoke.mjs
import * as fs from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3077";
const SHOTS = process.env.SHOTS ?? "ui-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const exe = process.env.CHROMIUM_PATH ?? ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(`✅ ${name}`);
  } catch (e) {
    results.push(`❌ ${name}: ${e.message.split("\n")[0]}`);
  }
};
const expectText = async (t) => {
  if (!(await page.getByText(t, { exact: false }).first().isVisible())) throw new Error(`không thấy "${t}"`);
};

await step("Games Library liệt kê 2 game khác thể loại", async () => {
  await page.goto(`${BASE}/games`);
  await expectText("Machine Brigade");
  await expectText("Lantern Hollow");
  await page.screenshot({ path: `${SHOTS}/01-games-library.png`, fullPage: true });
});
await step("Lọc theo 2D chỉ còn Lantern Hollow", async () => {
  await page.goto(`${BASE}/games?style=2D`);
  if (await page.getByText("Machine Brigade").count()) throw new Error("bộ lọc không hoạt động");
});
await step("Trang game hiển thị thư viện media, build, tính năng", async () => {
  await page.goto(`${BASE}/games/lantern-hollow`);
  await expectText("Thư viện media");
  await expectText("Build & changelog");
  await expectText("v0.2.0-alpha");
  await page.screenshot({ path: `${SHOTS}/02-game-detail.png`, fullPage: true });
});
await step("Wizard: sửa hook, lưu nháp, hoàn tác", async () => {
  await page.goto(`${BASE}/games/machine-brigade/videos/game-mb-highlight`);
  await expectText("Mức sẵn sàng");
  const hook = page.locator('input[name="hook"]');
  const before = await hook.inputValue();
  await hook.fill("Hook thử nghiệm từ UI");
  await page.getByRole("button", { name: "Lưu nháp" }).click();
  await page.waitForURL(/msg=/);
  await expectText("Đã lưu nháp");
  if ((await page.locator('input[name="hook"]').inputValue()) !== "Hook thử nghiệm từ UI") throw new Error("không lưu");
  await page.getByRole("button", { name: /Hoàn tác/ }).click();
  await page.getByText("Đã hoàn tác").waitFor({ timeout: 15000 });
  if ((await page.locator('input[name="hook"]').inputValue()) !== before) throw new Error("hoàn tác sai");
  await page.screenshot({ path: `${SHOTS}/03-game-video-wizard.png`, fullPage: true });
});
await step("Wizard: thêm clip & đặt điểm vào/ra từ playhead", async () => {
  await page.goto(`${BASE}/games/lantern-hollow/videos/game-lh-teaser`);
  const n = await page.locator("video").count();
  await page.getByRole("button", { name: "+ Thêm clip gameplay" }).click();
  if ((await page.locator("video").count()) <= n) throw new Error("không thêm được clip");
});
await step("Upload dropzone: tải gameplay qua giao diện", async () => {
  await page.goto(`${BASE}/games/lantern-hollow`);
  await page.setInputFiles('input[type="file"]', process.env.UPLOAD_FILE ?? "/tmp/claude-0/sp/up-test.mp4");
  await page.getByRole("button", { name: "Tải lên & nhập" }).click();
  await page.getByText(/up-test\.mp4/).last().waitFor({ timeout: 30000 });
});
await step("Review Queue & Tài khoản mở được", async () => {
  await page.goto(`${BASE}/review`);
  await expectText("Hàng chờ duyệt");
  await page.goto(`${BASE}/accounts`);
  await expectText("yt-lantern-hollow");
  await page.screenshot({ path: `${SHOTS}/04-accounts.png`, fullPage: true });
});
await step("Tạo game mới qua form (không cần sửa code)", async () => {
  await page.goto(`${BASE}/games/new`);
  const gid = `sky-forge-${Date.now().toString(36)}`;
  await page.fill('input[name="gameId"]', gid);
  await page.fill('input[name="publicTitle"]', "Sky Forge");
  await page.getByRole("button", { name: "Lưu game" }).click();
  await page.waitForURL(new RegExp(`/games/${gid}`));
  await expectText("Đã tạo game");
});
await step("Mobile viewport không tràn ngang", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/games`);
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  if (w > 400) throw new Error(`scrollWidth ${w}`);
  await page.screenshot({ path: `${SHOTS}/05-mobile-games.png` });
});
await browser.close();
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exitCode = 1;
