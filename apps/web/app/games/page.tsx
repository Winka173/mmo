import Link from "next/link";
import Msg from "../components/Msg";
import { GAME_STATUS_VI, gameMediaUrl, getGames } from "../lib/data";

export const dynamic = "force-dynamic";

/** Games Library — every game is an independent project (not only Machine Brigade). */
export default async function GamesLibrary({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const games = await getGames();
  const all = await games.list();
  const q = (sp.q ?? "").toLowerCase();
  const rows = await Promise.all(
    all
      .filter((g) => (!sp.status || g.status === sp.status) && (!sp.style || g.style === sp.style) && (!q || `${g.publicTitle} ${g.genres.join(" ")} ${g.tags.join(" ")}`.toLowerCase().includes(q)))
      .map(async (g) => {
        const media = await games.media(g.gameId);
        return { g, logo: media.find((a) => a.kind === "logo"), gameplay: media.filter((a) => a.kind === "gameplay").length, videos: (await games.listVideos(g.gameId)).length };
      }),
  );
  return (
    <div className="space-y-4">
      <Msg msg={sp.msg} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Thư viện game</h1>
        <Link className="btn" href="/games/new">+ Tạo game</Link>
      </div>
      <form className="flex flex-wrap gap-2 text-sm">
        <input name="q" defaultValue={sp.q} placeholder="Tìm theo tên/thể loại/tag" className="input max-w-xs" aria-label="Tìm" />
        <select name="status" defaultValue={sp.status ?? ""} className="input max-w-[10rem]" aria-label="Trạng thái"><option value="">Mọi trạng thái</option>{Object.entries(GAME_STATUS_VI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="style" defaultValue={sp.style ?? ""} className="input max-w-[8rem]" aria-label="Phong cách"><option value="">2D/3D</option><option>2D</option><option>2.5D</option><option>3D</option></select>
        <button className="btn-ghost">Lọc</button>
      </form>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(({ g, logo, gameplay, videos }) => (
          <Link key={g.gameId} href={`/games/${g.gameId}`} className="card flex gap-3 hover:border-amber-400">
            {logo ? <img src={gameMediaUrl(logo.path)} alt="" className="h-16 w-16 rounded-lg object-contain" /> : <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-200 text-xs dark:bg-slate-800">chưa có logo</div>}
            <div className="min-w-0">
              <div className="font-semibold">{g.publicTitle} {g.draft && <span className="badge bg-slate-200 dark:bg-slate-700">nháp</span>}</div>
              <div className="text-xs text-slate-500">{[g.style, g.engine, g.status && GAME_STATUS_VI[g.status], g.genres.join(", ")].filter(Boolean).join(" · ")}</div>
              <div className="mt-1 text-xs">{gameplay} clip gameplay · {videos} video · {g.destinationAllowlist.length} kênh{g.embargoUntil && new Date(g.embargoUntil) > new Date() ? " · ⛔ embargo" : ""}</div>
            </div>
          </Link>
        ))}
      </div>
      {!rows.length && <p className="text-sm text-slate-500">Chưa có game nào. Bấm “Tạo game” hoặc chạy <code>pnpm factory game-seed-fixtures</code> để có 2 game mẫu.</p>}
    </div>
  );
}
