// Usage: pnpm vitest run --reporter=json --outputFile=.test-results.json ; pnpm tsx scripts/gen-edge-matrix.ts .test-results.json
import * as fs from "node:fs";
import { EDGE_CASES } from "../apps/worker/test/edge-cases.ts";

const resultsFile = process.argv[2];
const status = new Map<string, string>();
if (resultsFile && fs.existsSync(resultsFile)) {
  const r = JSON.parse(fs.readFileSync(resultsFile, "utf8"));
  for (const f of r.testResults ?? []) for (const a of f.assertionResults ?? []) status.set(a.title, a.status);
}
const icon = (s: string | undefined) => (s === "passed" ? "✅ pass" : s === "failed" ? "❌ FAIL" : s ? s : "— (chưa chạy)");
const rows = EDGE_CASES.map((c) => `| ${c.caseId} | ${c.area} | ${c.edgeCase} | ${c.setup} | ${c.trigger} | ${c.expected} | ${c.externalSideEffects} | ${c.cost} | ${c.telegram} | \`${c.test.split(" > ")[0]}\` — ${c.test.split(" > ").at(-1)} | ${icon(status.get(c.test.split(" > ").at(-1)!))} |`);
const md = [
  "# Edge-case matrix (spec AC + Q)",
  "",
  `Sinh tự động từ \`apps/worker/test/edge-cases.ts\` + kết quả vitest (${resultsFile ? new Date(fs.statSync(resultsFile).mtime).toISOString() : "chưa có file kết quả"}). Mỗi dòng trỏ tới test chứng minh hành vi; test \`Edge-case registry integrity\` bảo đảm test tồn tại và mọi case bị chặn có side effect ngoài = 0.`,
  "",
  "| caseId | Khu vực | Edge case | Fixture/setup | Trigger | Kết quả mong đợi | Side effect ngoài | Chi phí | Telegram | Test | Trạng thái |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows,
  "",
  "Các ca V3 (mục Q2: Taobao CAPTCHA, không có quyền tải → IDEA_ONLY, trùng ảnh/khái niệm, crash giữa đăng, license bị thu hồi, mọi TTS lỗi, sai tài khoản, decision-trace) vẫn được giữ trong `packages/discovery/test`, `packages/media/test`, `apps/worker/test/publish.test.ts`.",
  "",
].join("\n");
fs.writeFileSync("docs/EDGE_CASE_MATRIX.md", md);
console.log(`docs/EDGE_CASE_MATRIX.md: ${EDGE_CASES.length} ca, ${[...EDGE_CASES].filter((c) => status.get(c.test.split(" > ").at(-1)!) === "passed").length} pass`);
