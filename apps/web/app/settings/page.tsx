import { toggleSetting } from "../actions";
import { getStore } from "../lib/data";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const store = await getStore();
  const s = await store.getSettings();
  const toggles = [
    ["killSwitch", "Kill switch toàn cục", s.killSwitch],
    ["paused", "Tạm dừng worker", s.paused],
    ["externalPostingEnabled", "Cho phép đăng ra ngoài (sau khi đã kết nối & kiểm thử)", s.externalPostingEnabled],
  ] as const;
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        {toggles.map(([key, label, on]) => (
          <form key={key} action={toggleSetting.bind(null, key)} className="flex items-center justify-between gap-4">
            <span>{label}: <b>{on ? "BẬT" : "Tắt"}</b></span>
            <button className="btn-ghost">{on ? "Tắt" : "Bật"}</button>
          </form>
        ))}
      </div>
      <div className="card text-sm">
        <p>DATA_DIR: <code>{store.root}</code></p>
        <p>Múi giờ: {s.timezone} · Chế độ mặc định: {s.defaultMode} · Giới hạn: {s.dailyCaps.shorts} short/ngày</p>
        <p>Ngân sách tháng: ${s.budgets.monthlyUsdCap} · AUTO_SAFE opt-in: {s.autoSafeOptIns.join(", ") || "chưa có"}</p>
        <p>Telegram allowlist: {s.telegram.allowedChatIds.join(", ") || "trống"}</p>
      </div>
    </div>
  );
}
