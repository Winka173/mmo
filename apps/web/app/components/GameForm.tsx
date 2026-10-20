import type { Account } from "@ttm/governance";
import type { GameProject } from "@ttm/games";
import type { BrandKitFile } from "@ttm/media";
import { saveGame } from "../games/actions";

const F = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="block"><span className="label">{label}</span>{children}{hint && <span className="text-[11px] text-slate-500">{hint}</span>}</label>
);

/** Create/Edit Game — complete settings; partial input saves as draft. */
export default function GameForm({ game, kit, accounts }: { game: GameProject | null; kit: BrandKitFile | null; accounts: Account[] }) {
  const g = game;
  const c = kit?.colors;
  return (
    <form action={saveGame} className="space-y-6">
      <section className="card grid gap-3 sm:grid-cols-2">
        <h2 className="h2 sm:col-span-2">Định danh</h2>
        <F label="gameId (slug, không đổi được sau khi tạo) *"><input name="gameId" required pattern="[a-z0-9][a-z0-9-]{2,59}" defaultValue={g?.gameId} readOnly={!!g} className="input" /></F>
        <F label="Tên công khai *"><input name="publicTitle" required defaultValue={g?.publicTitle} className="input" /></F>
        <F label="Tên nội bộ"><input name="internalName" defaultValue={g?.internalName} className="input" /></F>
        <F label="Tên tiếng Anh"><input name="titleEn" defaultValue={g?.localizedTitles.en} className="input" /></F>
        <F label="Tagline"><input name="tagline" defaultValue={g?.tagline} className="input" /></F>
        <F label="Studio"><input name="studio" defaultValue={g?.studio} className="input" /></F>
        <F label="Publisher"><input name="publisher" defaultValue={g?.publisher} className="input" /></F>
        <F label="Mô tả"><textarea name="description" defaultValue={g?.description} className="input" rows={2} /></F>
        <F label="Thể loại (phẩy)"><input name="genres" defaultValue={g?.genres.join(", ")} className="input" /></F>
        <F label="Tags/hashtag (phẩy)"><input name="tags" defaultValue={g?.tags.join(", ")} className="input" /></F>
        <F label="Chế độ chơi (phẩy)"><input name="gameplayModes" defaultValue={g?.gameplayModes.join(", ")} className="input" /></F>
        <F label="Phong cách"><select name="style" defaultValue={g?.style ?? ""} className="input"><option value="">—</option><option>2D</option><option>2.5D</option><option>3D</option><option value="other">khác</option></select></F>
        <F label="Engine"><input name="engine" defaultValue={g?.engine ?? ""} className="input" placeholder="Unity / Unreal / Godot / custom" /></F>
        <F label="Trạng thái"><select name="status" defaultValue={g?.status ?? ""} className="input"><option value="">—</option><option value="prototype">Prototype</option><option value="pre_alpha">Pre-alpha</option><option value="alpha">Alpha</option><option value="beta">Beta</option><option value="early_access">Early access</option><option value="released">Đã phát hành</option></select></F>
        <F label="Nền tảng" hint="vd: Android:in_development, PC:planned, iOS:released"><input name="platforms" defaultValue={g?.platforms.map((p) => `${p.name}:${p.status}`).join(", ")} className="input" /></F>
        <F label="Ngôn ngữ (phẩy)"><input name="languages" defaultValue={g?.languages.join(", ") ?? "vi"} className="input" /></F>
        <F label="Khán giả mục tiêu"><input name="audience" defaultValue={g?.audience} className="input" /></F>
        <F label="Khu vực"><input name="regions" defaultValue={g?.regions.join(", ")} className="input" /></F>
        <F label="Phân loại độ tuổi (nếu biết)"><input name="ageRating" defaultValue={g?.ageRating ?? ""} className="input" /></F>
      </section>
      <section className="card grid gap-3 sm:grid-cols-2">
        <h2 className="h2 sm:col-span-2">Phát hành, quyền & CTA</h2>
        <F label="Ngày phát hành (chỉ hiển thị khi đã xác nhận)"><input type="date" name="releaseDate" defaultValue={g?.releaseDate?.date} className="input" /></F>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="releaseConfirmed" defaultChecked={g?.releaseDate?.confirmed} /> Ngày đã xác nhận chính thức</label>
        <F label="Embargo đến (không đăng trước thời điểm này)"><input type="datetime-local" name="embargoUntil" defaultValue={g?.embargoUntil?.slice(0, 16)} className="input" /></F>
        <F label="Mục tiêu CTA"><select name="ctaGoal" defaultValue={g?.ctaGoal ?? "follow"} className="input">{["follow", "wishlist", "waitlist", "demo", "install", "store_click", "community", "playtest"].map((x) => <option key={x}>{x}</option>)}</select></F>
        <F label="Link chính thức" hint="mỗi dòng: Nhãn|loại|https://url|xác nhận (1 = đã xác nhận). Loại: steam, app_store, google_play, landing, wishlist, waitlist, discord, demo, playtest, itch, other. Không có link => CTA chỉ là theo dõi."><textarea name="storeLinks" rows={3} className="input font-mono text-xs" defaultValue={g?.storeLinks.map((l) => `${l.label}|${l.kind}|${l.url}|${l.confirmedByOwner ? 1 : 0}`).join("\n")} /></F>
        <div className="grid gap-2">
          <F label="UTM campaign (tùy chọn)"><input name="utmCampaign" defaultValue={g?.utm?.campaign} className="input" /></F>
          <div className="grid grid-cols-2 gap-2"><F label="UTM source"><input name="utmSource" defaultValue={g?.utm?.source} className="input" /></F><F label="UTM medium"><input name="utmMedium" defaultValue={g?.utm?.medium} className="input" /></F></div>
        </div>
        <F label="Chủ sở hữu quyền *(bắt buộc trước khi đăng)"><input name="owner" defaultValue={g?.ownerRights?.owner} className="input" /></F>
        <F label="Tuyên bố quyền"><input name="ownerStatement" defaultValue={g?.ownerRights?.statement} className="input" /></F>
        <fieldset className="sm:col-span-2"><legend className="label">Kênh được phép đăng (chỉ tài khoản thuộc game này)</legend>
          {accounts.length ? accounts.map((a) => <label key={a.id} className="mr-4 inline-flex items-center gap-1 text-sm"><input type="checkbox" name="destinationAllowlist" value={a.id} defaultChecked={g?.destinationAllowlist.includes(a.id)} />{a.displayName} ({a.platform})</label>) : <p className="text-xs text-slate-500">Chưa có tài khoản nào thuộc game này — thêm ở trang Tài khoản (owner = game:{g?.gameId ?? "<gameId>"}). Không dùng kênh Tủ Tò Mò cho game.</p>}
        </fieldset>
        <F label="Số bài/tuần"><input type="number" min={0} max={21} name="postsPerWeek" defaultValue={g?.schedule.postsPerWeek ?? 3} className="input" /></F>
        <F label="Giờ đăng ưu tiên (0–23, phẩy)"><input name="preferredHours" defaultValue={g?.schedule.preferredHours.join(", ") ?? "18, 20"} className="input" /></F>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="draft" defaultChecked={g?.draft ?? true} /> Còn là nháp</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allowCloudUpload" defaultChecked={g?.allowCloudUpload} /> Cho phép gửi asset chưa công bố lên dịch vụ cloud (mặc định TẮT)</label>
      </section>
      <section className="card grid gap-3 sm:grid-cols-3">
        <h2 className="h2 sm:col-span-3">Brand kit riêng của game (v{kit?.kitVersion ?? 0} → lưu tạo phiên bản mới)</h2>
        {(["bg1", "bg2", "accent", "text", "muted", "badge"] as const).map((k) => <F key={k} label={`Màu ${k}`}><input type="color" name={`c_${k}`} defaultValue={c?.[k] ?? { bg1: "#2B2D33", bg2: "#16171B", accent: "#E8E8E8", text: "#FFFFFF", muted: "#B9BCC4", badge: "#9AD1FF" }[k]} className="input h-9" /></F>)}
        <F label="Giọng đọc (espeak voice)"><input name="voice" defaultValue={kit?.voice.voice ?? "vi"} className="input" /></F>
        <F label="Tốc độ đọc (từ/phút)"><input type="number" name="voiceSpeed" defaultValue={kit?.voice.speedWpm ?? 165} className="input" /></F>
        <F label="Cao độ"><input type="number" name="voicePitch" defaultValue={kit?.voice.pitch ?? 45} className="input" /></F>
        <F label="Cụm từ cấm (phẩy)"><input name="bannedPhrases" defaultValue={kit?.bannedPhrases.join(", ")} className="input" /></F>
        <F label="Phát âm (mỗi dòng: Tên => cách đọc)"><textarea name="pronunciation" rows={2} className="input" defaultValue={kit?.pronunciation.map((p) => `${p.from} => ${p.to}`).join("\n")} /></F>
        <F label="Giọng biên tập"><input name="editorialVoice" defaultValue={kit?.editorialVoice} className="input" /></F>
        <p className="text-xs text-slate-500 sm:col-span-3">Logo lấy từ asset loại “logo” đã tải lên; nếu chưa có, video dùng tên game dạng chữ (không tạo logo giả).</p>
      </section>
      <button className="btn">Lưu game</button>
    </form>
  );
}
