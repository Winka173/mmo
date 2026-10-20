"use server";
import { ABTestingEngine, SelfLearningEngine } from "@ttm/insights";
import { TelegramOutbox } from "@ttm/telegram";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getStore } from "../lib/data";

const ACTOR = "web-ui (localhost)";
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (p: string, m: string): never => redirect(`${p}?msg=${encodeURIComponent(m)}`);

export async function saveBudget(formData: FormData) {
  const store = await getStore();
  const n = (k: string) => Math.max(0, Number(str(formData, k) || 0));
  await store.updateSettings((s) => ({ ...s, budgets: { ...s.budgets, monthlyUsdCap: n("monthly"), perVideoUsdCap: n("perVideo") }, spend: { ...s.spend, dailyUsdCap: n("daily"), weeklyUsdCap: n("weekly"), paidProviderAllowlist: str(formData, "allow").split(",").map((x) => x.trim()).filter(Boolean) } }), ACTOR);
  back("/budget", "Đã lưu trần ngân sách");
}

export async function saveFeatures(formData: FormData) {
  const store = await getStore();
  await store.updateSettings(
    (s) => ({
      ...s,
      features: Object.fromEntries(Object.keys(s.features).map((k) => [k, formData.get(`f_${k}`) === "on"])) as typeof s.features,
      quality: { ...s.quality, mode: (str(formData, "qaMode") || s.quality.mode) as any, maxRepairIterations: Number(str(formData, "maxRepair") || s.quality.maxRepairIterations) },
      learning: { ...s.learning, frozen: formData.get("frozen") === "on", explorationRatio: Number(str(formData, "explore") || s.learning.explorationRatio) },
    }),
    ACTOR,
  );
  revalidatePath("/settings");
  back("/settings", "Đã lưu tính năng");
}

export async function saveTelegram(formData: FormData) {
  const store = await getStore();
  const ids = str(formData, "chatIds").split(/[,\s]+/).filter((x) => /^-?\d{3,20}$/.test(x));
  await store.updateSettings((s) => ({ ...s, telegram: { ...s.telegram, enabled: formData.get("enabled") === "on", allowedChatIds: ids } }), ACTOR);
  back("/telegram", `Đã lưu allowlist (${ids.length} chat). Token bot chỉ nhập qua CLI: factory secrets set telegram.botToken`);
}

export async function sendTestTelegram() {
  const store = await getStore();
  const s = await store.getSettings();
  const ob = new TelegramOutbox(store);
  for (const chatId of s.telegram.allowedChatIds) await ob.enqueue({ chatId, kind: "text", text: "🔔 Tin thử từ Control Center (localhost)", file: null, dedupeKey: `ui-test:${Date.now()}` });
  back("/telegram", s.telegram.allowedChatIds.length ? "Đã đưa tin thử vào outbox — worker sẽ gửi" : "Chưa có chat nào trong allowlist");
}

export async function createExperiment(formData: FormData) {
  const eng = new ABTestingEngine(await getStore());
  try {
    const r = await eng.create(
      { id: str(formData, "id"), hypothesis: str(formData, "hypothesis"), variable: str(formData, "variable") as any, design: str(formData, "design") as any, owner: str(formData, "owner") || "tutomo", platform: str(formData, "platform"), primaryMetric: str(formData, "metric") as any, minSamplePerArm: Number(str(formData, "minSample") || 8), arms: [{ id: "A", description: str(formData, "armA") }, { id: "B", description: str(formData, "armB") }] },
      { sameFeedSimultaneous: formData.get("sameFeed") === "on", affiliate: formData.get("affiliate") === "on" },
    );
    back("/experiments", r.experiment ? "Đã tạo thử nghiệm" : `Không tạo: ${r.issues.join("; ")}`);
  } catch (e: any) {
    if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e;
    back("/experiments", `Lỗi: ${e.issues ? e.issues.map((i: any) => i.message).join("; ") : e.message}`);
  }
}

export async function undoLearning() {
  const r = await new SelfLearningEngine(await getStore()).undo(ACTOR);
  back("/analytics", r ? `Đã hoàn tác về phiên bản trước (v${r.version})` : "Không có phiên bản để hoàn tác");
}
