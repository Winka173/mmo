import * as fs from "node:fs/promises";
import { HELP } from "@ttm/telegram";
import Msg from "../components/Msg";
import { saveTelegram, sendTestTelegram } from "../admin/actions";
import { getStore } from "../lib/data";

export const dynamic = "force-dynamic";

export default async function TelegramPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const store = await getStore();
  const s = await store.getSettings();
  const hasToken = await fs.access(store.p("secrets", "telegram.botToken.secret")).then(() => true, () => false);
  const outbox = (await fs.readdir(store.p("telegram", "outbox")).catch(() => [] as string[])).length;
  const sent = (await fs.readdir(store.p("telegram", "sent")).catch(() => [] as string[])).sort().slice(-1)[0];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Telegram</h1>
      <Msg msg={sp.msg} />
      <div className="card text-sm space-y-1">
        <p>Token bot: <b>{hasToken ? "đã lưu (mã hóa)" : "chưa có"}</b> — chỉ nhập qua CLI <code>pnpm factory secrets set telegram.botToken</code> (không qua web, không log).</p>
        <p>Tin chờ gửi trong outbox: {outbox} · tin gần nhất đã gửi: {sent ?? "—"}</p>
        <p>Worker dùng long polling (không mở cổng). <code>/start</code> không cấp quyền; cả chat và người gửi phải thuộc allowlist.</p>
      </div>
      <form action={saveTelegram} className="card grid gap-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={s.telegram.enabled} /> Bật thông báo Telegram</label>
        <label className="label">Chat ID được phép (phẩy)<input name="chatIds" defaultValue={s.telegram.allowedChatIds.join(", ")} className="input" /></label>
        <button className="btn">Lưu</button>
      </form>
      <form action={sendTestTelegram}><button className="btn-ghost">Gửi tin thử</button></form>
      <section className="card"><h2 className="h2">Lệnh</h2><pre className="whitespace-pre-wrap text-xs">{HELP}</pre></section>
    </div>
  );
}
