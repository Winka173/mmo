import { Platform } from "@ttm/core";
import Msg from "../components/Msg";
import { confirmAccount, disableAccount, saveAccount } from "../games/actions";
import { getAccounts, getGames } from "../lib/data";

export const dynamic = "force-dynamic";

/** MultiAccountManager UI — each account belongs to exactly one brand or game. */
export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const accounts = await (await getAccounts()).list();
  const games = await (await getGames()).list();
  const owners = [{ v: "brand:tutomo", l: "Thương hiệu Tủ Tò Mò" }, ...games.map((g) => ({ v: `game:${g.gameId}`, l: `Game: ${g.publicTitle}` }))];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Tài khoản đăng bài</h1>
      <Msg msg={sp.msg} />
      <p className="text-sm text-slate-500">Mỗi tài khoản gắn với đúng một chủ sở hữu (thương hiệu hoặc game). Hệ thống chỉ đăng khi tài khoản thuộc đúng chủ, nằm trong danh sách cho phép của game, đã được bạn xác nhận, và credential đang kết nối đúng kênh (expected remote id). Credential lưu riêng ở <code>secrets/acct.&lt;id&gt;.*</code> (DPAPI trên Windows).</p>
      <table className="card">
        <thead><tr><th>ID</th><th>Nền tảng</th><th>Chủ sở hữu</th><th>Tên</th><th>Remote id mong đợi</th><th>Trạng thái</th><th /></tr></thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id}>
              <td className="font-mono text-xs">{a.id}</td><td>{a.platform}</td><td>{a.owner.kind}:{a.owner.id}</td><td>{a.displayName}</td><td className="font-mono text-xs">{a.expectedRemoteId ?? "—"}</td>
              <td>{!a.enabled ? "TẮT" : a.confirmedAt ? `✅ xác nhận ${a.confirmedAt.slice(0, 10)}` : "⛔ chưa xác nhận"}</td>
              <td className="flex gap-1">{!a.confirmedAt && a.enabled && <form action={confirmAccount.bind(null, a.id)}><button className="btn-ghost">Xác nhận</button></form>}{a.enabled && <form action={disableAccount.bind(null, a.id)}><button className="btn-ghost">Tắt</button></form>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form action={saveAccount} className="card grid gap-2 text-sm sm:grid-cols-3">
        <h2 className="h2 sm:col-span-3">Thêm / sửa tài khoản</h2>
        <label className="label">ID (vd yt-ten-game)<input name="id" required pattern="[a-z0-9][a-z0-9_-]{2,60}" className="input" /></label>
        <label className="label">Nền tảng<select name="platform" className="input">{Platform.options.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label className="label">Chủ sở hữu<select name="owner" className="input">{owners.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select></label>
        <label className="label">Tên hiển thị<input name="displayName" required className="input" /></label>
        <label className="label">Remote id mong đợi (channel/page id)<input name="expectedRemoteId" className="input" /></label>
        <button className="btn self-end">Lưu (cần xác nhận lại)</button>
      </form>
    </div>
  );
}
