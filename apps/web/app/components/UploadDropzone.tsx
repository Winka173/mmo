"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const KINDS: [string, string][] = [["", "Tự nhận diện"], ["gameplay", "Gameplay (quay thật)"], ["thumbnail", "Thumbnail"], ["screenshot", "Ảnh chụp màn hình"], ["logo", "Logo"], ["key_art", "Key art"], ["character", "Nhân vật/sprite"], ["render", "Render 3D"], ["trailer", "Trailer chính chủ"], ["music", "Nhạc (có license)"], ["audio", "SFX/âm thanh"], ["ai_concept", "Concept/AI (không phải gameplay)"], ["before_after", "Trước/sau"]];

/** Drag & drop / file picker with real upload progress (XHR) to /api/games/<id>/upload. */
export default function UploadDropzone({ gameId, builds }: { gameId: string; builds: string[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const upload = (form: HTMLFormElement) => {
    if (!files.length) return setError("Chưa chọn file");
    const fd = new FormData(form);
    fd.delete("files");
    for (const f of files) fd.append("files", f, f.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/games/${gameId}/upload`);
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setProgress(null);
      try {
        const j = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) setError(j.error ?? `HTTP ${xhr.status}`);
        else {
          setResult(j.results);
          setFiles([]);
          router.refresh();
        }
      } catch {
        setError(`Phản hồi không hợp lệ (HTTP ${xhr.status})`);
      }
    };
    xhr.onerror = () => {
      setProgress(null);
      setError("Mất kết nối khi tải lên — thử lại (file đã nhập trước đó sẽ được nhận diện trùng, không nhân bản)");
    };
    setError(null);
    setResult(null);
    xhr.send(fd);
  };

  return (
    <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), upload(e.currentTarget))}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Kéo thả file vào đây hoặc bấm để chọn"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => (e.preventDefault(), setOver(false), setFiles([...files, ...Array.from(e.dataTransfer.files)]))}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center text-sm ${over ? "border-amber-500 bg-amber-50 dark:bg-amber-950" : "border-slate-300 dark:border-slate-700"}`}
      >
        Kéo thả gameplay MP4/MOV/WEBM, thumbnail, ảnh, logo, ZIP, CSV shot list vào đây — hoặc bấm để chọn
        <input ref={input} type="file" multiple hidden accept=".mp4,.mov,.webm,.mkv,.m4v,.png,.jpg,.jpeg,.webp,.wav,.mp3,.m4a,.ogg,.flac,.zip,.csv,.glb,.fbx" onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
      </div>
      {files.length > 0 && (
        <ul className="text-xs">
          {files.map((f, i) => (
            <li key={i}>
              {f.name} · {(f.size / 1024 / 1024).toFixed(1)} MB{" "}
              <button type="button" className="underline" onClick={() => setFiles(files.filter((_, j) => j !== i))}>bỏ</button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-xs">Loại<select name="kind" className="input">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="text-xs">Build<select name="buildId" className="input"><option value="">(không gán)</option>{builds.map((b) => <option key={b}>{b}</option>)}</select></label>
        <label className="text-xs sm:col-span-2">Ghi chú điều thực sự xảy ra<input name="annotation" className="input" placeholder="vd: hạ boss tầng 3 bằng combo lướt" /></label>
      </div>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="lockedThumbnail" /> Khóa thumbnail này (LOCK_USER_THUMBNAIL — không bao giờ bị tự thay)</label>
      <button className="btn" disabled={progress !== null}>{progress !== null ? `Đang tải ${progress}%` : "Tải lên & nhập"}</button>
      {progress !== null && <div className="h-2 w-full rounded bg-slate-200"><div className="h-2 rounded bg-amber-500" style={{ width: `${progress}%` }} /></div>}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {result && (
        <ul className="text-xs">
          {result.flatMap((r: any) => r.items ?? (r.shotList ? [{ originalName: "CSV shot list", result: r.shotList.errors.length ? "rejected" : "imported", reason: `${r.shotList.clips.length} clip; ${r.shotList.errors.join("; ")}` }] : [{ originalName: "?", result: "rejected", reason: r.error }])).map((i: any, k: number) => (
            <li key={k}>{i.result === "imported" ? "✅" : i.result === "duplicate" ? "♻️" : "⛔"} {i.originalName} {i.reason ? `— ${i.reason}` : ""}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
