import { toggleSetting } from "../actions";
import { saveFeatures } from "../admin/actions";
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
      <form action={saveFeatures} className="card grid gap-2 text-sm sm:grid-cols-3">
        <h2 className="h2 sm:col-span-3">Tính năng V4 (mặc định an toàn)</h2>
        {Object.entries(s.features).map(([k, on]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" name={`f_${k}`} defaultChecked={on} /> {k}</label>)}
        <label className="label">Chế độ QA<select name="qaMode" defaultValue={s.quality.mode} className="input"><option>FAST_QA</option><option>STANDARD_QA</option><option>PREMIUM_QA</option></select></label>
        <label className="label">Số vòng tự sửa tối đa<input name="maxRepair" type="number" min={0} max={5} defaultValue={s.quality.maxRepairIterations} className="input" /></label>
        <label className="label">Tỉ lệ khám phá<input name="explore" type="number" step="0.05" min={0} max={1} defaultValue={s.learning.explorationRatio} className="input" /></label>
        <label className="flex items-center gap-2"><input type="checkbox" name="frozen" defaultChecked={s.learning.frozen} /> Đóng băng học tự động</label>
        <button className="btn">Lưu</button>
      </form>
      <div className="card text-sm">
        <p>DATA_DIR: <code>{store.root}</code></p>
        <p>Múi giờ: {s.timezone} · Chế độ mặc định: {s.defaultMode} · Giới hạn: {s.dailyCaps.shorts} short/ngày</p>
        <p>Ngân sách tháng: ${s.budgets.monthlyUsdCap} · AUTO_SAFE opt-in: {s.autoSafeOptIns.join(", ") || "chưa có"}</p>
        <p>Telegram allowlist: {s.telegram.allowedChatIds.join(", ") || "trống"}</p>
      </div>
    </div>
  );
}
