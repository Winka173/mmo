"use client";
import { useState } from "react";
import type { VoiceSample } from "@ttm/automation";
import VoiceEvaluation from "./VoiceEvaluation";

type Props = { en: boolean; busy: boolean; voices: VoiceSample[]; paused: boolean; worker: unknown; call: (body: Record<string, unknown>) => Promise<any> };
const samples: Record<string, string> = {
  "vi-VN": "Xin chào, đây là bản nghe thử giọng Việt của Autonomous Creative Studio. Hãy kiểm tra cách phát âm, nhịp đọc và tên thương hiệu trước khi sử dụng.",
  "en-US": "Welcome to Autonomous Creative Studio. Please review the pronunciation, pacing, and brand names before using this local voice in your project.",
  "en-GB": "Welcome to Autonomous Creative Studio. Please review this British English voice, including its pronunciation, pacing, and brand names.",
};
export default function VoiceStudio({ en, busy, voices, paused, worker, call }: Props) {
  const t = (vi: string, english: string) => en ? english : vi;
  const [root, setRoot] = useState(""); const [detected, setDetected] = useState<any>(null);
  const [language, setLanguage] = useState("vi-VN"), [text, setText] = useState(samples["vi-VN"]);
  const [heard, setHeard] = useState<Record<string, boolean>>({});
  return <>
    <section className="acs-panel"><h2>{t("Tìm môi trường AI đã cài", "Find installed local AI")}</h2>
      <p>{t("Chọn thư mục setup để tìm Python, model và FFmpeg. Bạn có thể xem đường dẫn trước khi lưu.", "Choose a setup folder to locate Python, models and FFmpeg. Review the detected paths before saving.")}</p>
      <form className="acs-actions" onSubmit={e => { e.preventDefault(); void call({ action: "discover-tools", root }).then(setDetected).catch(() => {}); }}>
        <label className="acs-field acs-grow">{t("Thư mục setup local", "Local setup folder")}<input required value={root} placeholder="C:\\Projects\\studio" onChange={e => setRoot(e.target.value)} /></label>
        <button disabled={busy}>{t("Tìm công cụ", "Find tools")}</button>
      </form>
      {detected && <div><p>{t("Đã tìm thấy", "Found")}: {detected.found.join(", ") || t("Chưa tìm thấy công cụ phù hợp", "No compatible tools found")}</p>
        <details><summary>{t("Xem đường dẫn", "Review paths")}</summary><pre>{JSON.stringify(Object.fromEntries(detected.found.map((k: string) => [k, detected.config[k]])), null, 2)}</pre></details>
        <button className="acs-primary" disabled={busy || !detected.found.length} onClick={() => void call({ action: "save-config", value: detected.config }).then(() => setDetected(null)).catch(() => {})}>{t("Dùng cấu hình này", "Use this configuration")}</button>
      </div>}
    </section>
    <section className="acs-panel"><h2>{t("Phòng nghe thử giọng", "Voice auditions")}</h2>
      <p>{t("Tạo WAV thật bằng model local trong cấu hình hiện tại. Mỗi mẫu giữ lại checkpoint, thiết bị và thời gian chạy; duyệt giọng là bước riêng với duyệt đăng video.", "Generate real WAV audio with your configured local model. Each sample records checkpoint, device and timing; voice review is separate from video publication approval.")}</p>
      {(paused || !worker) && <p className="acs-alert">{t("Worker cần chạy và hàng đợi cần được tiếp tục để tạo mẫu. Yêu cầu vẫn được lưu khi đang tạm dừng.", "The worker and queue must be running to generate audio. Requests remain saved while paused.")}</p>}
      <form onSubmit={e => { e.preventDefault(); void call({ action: "voice-sample", language, text }).catch(() => {}); }}>
        <div className="acs-form-grid"><label className="acs-field" htmlFor="voice-audition-language">{t("Ngôn ngữ giọng", "Voice language")}</label><select id="voice-audition-language" value={language} onChange={e => { setLanguage(e.target.value); setText(samples[e.target.value]); }}><option value="vi-VN">Tiếng Việt</option><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option></select></div>
        <label className="acs-field" htmlFor="voice-audition-text">{t("Nội dung nghe thử", "Audition text")}</label><textarea id="voice-audition-text" required rows={4} maxLength={1500} value={text} onChange={e => setText(e.target.value)} />
        <p className="acs-muted">{t("Thay giọng/model trong Cài đặt. Thiếu CUDA hoặc GPU đang bận sẽ báo trạng thái, không dùng API trả phí.", "Choose voices/models in Settings. Missing CUDA or a busy GPU is reported; paid APIs are never substituted.")}</p>
        <button className="acs-primary" disabled={busy || !text.trim()}>{t("Tạo mẫu giọng local", "Generate local voice sample")}</button>
      </form>
    </section>
    <details className="acs-panel"><summary>{t("So sánh chất lượng giọng trước / sau đổi model", "Compare voice quality before / after model changes")}</summary><VoiceEvaluation en={en} busy={busy} voices={voices} call={call}/></details>
    <div className="acs-card-grid">{voices.slice(0, 24).map(row => <section className="acs-panel" key={row.id}>
      <span className={`acs-badge ${row.state}`}>{row.language} · {row.state}</span>
      <h2>{String(row.evidence?.voice ?? (row.language === "vi-VN" ? row.config.voiceVi : row.language === "en-GB" ? row.config.voiceEnGb : row.config.voiceEn))}</h2>
      <p>{row.text}</p>
      {row.error && <p className="acs-alert error">{row.error}</p>}
      {row.state === "ready" && <><audio controls preload="metadata" src={`/api/studio/voice/${row.id}`} onEnded={() => setHeard(current => ({ ...current, [row.id]: true }))} />
        <p className="acs-muted">{String(row.evidence?.device)} · {Number(row.evidence?.audio_seconds ?? 0).toFixed(2)}s audio · {Number(row.evidence?.seconds ?? 0).toFixed(2)}s {t("xử lý", "processing")}</p>
        <span className="acs-badge">{row.humanReview === "ACCEPTED" ? t("Bạn đã duyệt mẫu này", "You accepted this sample") : row.humanReview === "REJECTED" ? t("Bạn đã loại mẫu này", "You rejected this sample") : t("Chưa nghe duyệt", "Listening review pending")}</span>
        {row.evidence?.roundTrip && <details><summary>{t("Đối chiếu lời đọc bằng ASR local", "Local ASR speech comparison")} · {String((row.evidence.roundTrip as any).status)}</summary><pre>{JSON.stringify(row.evidence.roundTrip, null, 2)}</pre></details>}
        <div className="acs-actions"><button disabled={busy || !heard[row.id]} onClick={() => void call({ action: "voice-review", id: row.id, decision: "ACCEPTED", audioSha256: row.audioSha256 }).catch(() => {})}>{t("Đã nghe · Phát âm đạt", "Listened · Accept pronunciation")}</button><button disabled={busy || !heard[row.id]} onClick={() => void call({ action: "voice-review", id: row.id, decision: "REJECTED", audioSha256: row.audioSha256 }).catch(() => {})}>{t("Đã nghe · Cần cải thiện", "Listened · Needs improvement")}</button></div>
        {!heard[row.id] && <small className="acs-muted">{t("Nghe hết mẫu để ghi nhận đánh giá của bạn.", "Play the complete sample to record your review.")}</small>}
        <details><summary>{t("Checkpoint & benchmark", "Checkpoint & benchmark")}</summary><pre>{JSON.stringify(row.evidence, null, 2)}</pre></details>
      </>}
    </section>)}</div>
  </>;
}
