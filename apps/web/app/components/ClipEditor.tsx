"use client";
import { useRef, useState } from "react";

export type ClipAsset = { assetId: string; name: string; url: string; duration: number; label: string; heroTimes: number[] };
type Clip = { assetId: string; in: number; out: number; caption: string; annotation: string; narration: string };

/**
 * Timeline editor: pick a clip, scrub the real video, set in/out from the playhead, write the
 * caption/narration for what TRULY happens. Serialised into a hidden `clipsJson` field.
 */
export default function ClipEditor({ assets, initial }: { assets: ClipAsset[]; initial: Clip[] }) {
  const [clips, setClips] = useState<Clip[]>(initial);
  const refs = useRef<Record<number, HTMLVideoElement | null>>({});
  const upd = (i: number, p: Partial<Clip>) => setClips(clips.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const move = (i: number, d: number) => {
    const n = [...clips];
    const [x] = n.splice(i, 1);
    n.splice(Math.max(0, Math.min(n.length, i + d)), 0, x);
    setClips(n);
  };
  const byId = Object.fromEntries(assets.map((a) => [a.assetId, a]));
  return (
    <div className="space-y-4">
      <input type="hidden" name="clipsJson" value={JSON.stringify(clips)} />
      {clips.map((c, i) => {
        const a = byId[c.assetId];
        return (
          <div key={i} className="grid gap-3 rounded-lg border border-slate-200 p-3 md:grid-cols-[320px_1fr] dark:border-slate-700">
            <div>
              {a ? <video ref={(el) => { refs.current[i] = el; }} src={a.url} controls preload="metadata" className="w-full rounded bg-black" /> : <p className="text-xs text-red-600">Asset không còn trong thư viện game</p>}
              <div className="mt-1 flex flex-wrap gap-1 text-xs">
                <button type="button" className="btn-ghost" onClick={() => upd(i, { in: Math.round((refs.current[i]?.currentTime ?? 0) * 100) / 100 })}>⇤ Điểm vào = playhead</button>
                <button type="button" className="btn-ghost" onClick={() => upd(i, { out: Math.round((refs.current[i]?.currentTime ?? 0) * 100) / 100 })}>Điểm ra = playhead ⇥</button>
                <button type="button" className="btn-ghost" onClick={() => { const v = refs.current[i]; if (v) { v.currentTime = c.in; void v.play(); } }}>▶ Xem đoạn</button>
              </div>
              {a?.heroTimes.length ? <p className="mt-1 text-xs text-slate-500">Gợi ý điểm nhấn (phân tích): {a.heroTimes.map((t) => <button type="button" key={t} className="underline" onClick={() => { const v = refs.current[i]; if (v) v.currentTime = t; }}>{t.toFixed(1)}s </button>)}</p> : null}
            </div>
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <label className="sm:col-span-2">Clip<select className="input" value={c.assetId} onChange={(e) => upd(i, { assetId: e.target.value })}>{assets.map((x) => <option key={x.assetId} value={x.assetId}>{x.name} · {x.label} · {x.duration.toFixed(1)}s</option>)}</select></label>
              <label>Vào (s)<input className="input" type="number" step="0.01" min={0} value={c.in} onChange={(e) => upd(i, { in: Number(e.target.value) })} /></label>
              <label>Ra (s)<input className="input" type="number" step="0.01" min={0} value={c.out} onChange={(e) => upd(i, { out: Number(e.target.value) })} /></label>
              <label className="sm:col-span-2">Chú thích trên màn hình<input className="input" value={c.caption} onChange={(e) => upd(i, { caption: e.target.value })} /></label>
              <label className="sm:col-span-2">Điều thực sự xảy ra (annotation)<input className="input" value={c.annotation} onChange={(e) => upd(i, { annotation: e.target.value })} /></label>
              <label className="sm:col-span-2">Lời đọc (tùy chọn)<textarea className="input" rows={2} value={c.narration} onChange={(e) => upd(i, { narration: e.target.value })} /></label>
              <div className="flex gap-1 sm:col-span-2">
                <button type="button" className="btn-ghost" onClick={() => move(i, -1)} aria-label="Lên">↑</button>
                <button type="button" className="btn-ghost" onClick={() => move(i, 1)} aria-label="Xuống">↓</button>
                <button type="button" className="btn-ghost" onClick={() => setClips(clips.filter((_, j) => j !== i))}>Xóa clip</button>
                {a && <span className="self-center text-slate-500">dài {(Math.max(0, c.out - c.in)).toFixed(1)}s</span>}
              </div>
            </div>
          </div>
        );
      })}
      <button type="button" className="btn-ghost" disabled={!assets.length} onClick={() => assets[0] && setClips([...clips, { assetId: assets[0].assetId, in: 0, out: Math.min(assets[0].duration, 8), caption: "", annotation: "", narration: "" }])}>
        + Thêm clip gameplay
      </button>
      {!assets.length && <p className="text-xs text-amber-700">Chưa có video gameplay — tải lên ở trang game. Video loại gameplay sẽ bị giữ ở trạng thái WAITING_FOR_CAPTURE.</p>}
    </div>
  );
}
