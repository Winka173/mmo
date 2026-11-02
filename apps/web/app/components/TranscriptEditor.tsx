"use client";
import { useEffect, useMemo, useState } from "react";
import type { StudioRun } from "@ttm/automation";
import type { Timeline } from "@ttm/core";
import { planTranscriptCut, transcriptPhrases, TranscriptEditError, type TranscriptEditErrorCode } from "../../../../packages/core/src/transcript-edit";
import CaptionTimingEditor from "./CaptionTimingEditor";

type Props = { run: StudioRun; en: boolean; busy: boolean; call: (body: Record<string, unknown>) => Promise<any>; select: (id: string) => void; onSeek?: (seconds: number) => void };
const time = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;

export default function TranscriptEditor({ run, en, busy, call, select, onSeek }: Props) {
  const t = (vi: string, english: string) => en ? english : vi;
  const [timeline, setTimeline] = useState<Timeline | null>(null), [selected, setSelected] = useState<string[]>([]), [error, setError] = useState(""), [reviewed, setReviewed] = useState(false), [applying, setApplying] = useState(false);
  useEffect(() => {
    let current = true; const controller = new AbortController();
    setTimeline(null); setSelected([]); setError(""); setReviewed(false);
    fetch(`/api/studio/timeline/${encodeURIComponent(run.id)}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json(); if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
      if (current) setTimeline(value);
    }).catch(e => { if (current && e.name !== "AbortError") setError(e.message); });
    return () => { current = false; controller.abort(); };
  }, [run.id]);
  const phrases = useMemo(() => timeline ? transcriptPhrases(timeline) : [], [timeline]);
  const preview = useMemo(() => {
    if (!timeline || !selected.length) return { plan: null, problem: null };
    try { return { plan: planTranscriptCut(timeline, selected), problem: null }; }
    catch (e) { return { plan: null, problem: e instanceof TranscriptEditError ? e.code : "INVALID_RANGE" as TranscriptEditErrorCode }; }
  }, [timeline, selected]);
  const problems: Record<TranscriptEditErrorCode, string> = {
    NO_SELECTION: t("Chọn ít nhất một cụm từ.", "Select at least one phrase."),
    INVALID_RANGE: t("Timestamp ngoài video hoặc không hợp lệ. Kiểm tra timeline.", "Timestamps are invalid or outside the video. Review the timeline."),
    UNKNOWN_PHRASE: t("Cụm từ không còn trong phiên bản này. Tải lại phiên bản.", "A phrase is missing from this version. Reload the version."),
    WHOLE_VIDEO: t("Không thể xóa toàn bộ video.", "The entire video cannot be removed."),
    NO_RETAINED_SPEECH: t("Phải giữ lại ít nhất một cụm lời nói; không chỉ giữ hình hoặc khoảng lặng.", "Keep at least one spoken phrase; retaining only pictures or silence is insufficient."),
    PARTIAL_CAPTION: t("Khoảng cắt chồng lên một phần phụ đề khác. Chọn cả cụm chồng lấn hoặc sửa timestamp trong Timeline trước.", "A cut would split another caption. Select the overlapping phrase too or review its timestamps in Timeline first."),
    TOO_MANY_CUTS: t("Tối đa 50 khoảng cắt mỗi phiên bản. Chia thành nhiều lần chỉnh sửa.", "At most 50 cut ranges per version. Split this into separate edits."),
  };
  const toggle = (id: string) => { setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]); setReviewed(false); setError(""); };
  const apply = async () => {
    if (!preview.plan || !reviewed || applying || busy || run.state !== "ready") return;
    setApplying(true); setError("");
    try { const child = await call({ action: "edit-timeline", id: run.id, operations: preview.plan.operations }); select(child.id); }
    catch (e) { setError(e instanceof Error ? e.message : t("Không lưu được phiên bản.", "Could not save the version.")); }
    finally { setApplying(false); }
  };
  return <section className="acs-panel" aria-label={t("Chỉnh sửa theo bản chép lời", "Transcript editing")}>
    <h3>{t("Cắt theo cụm lời nói", "Cut by spoken phrase")}</h3>
    <p className="acs-muted">{t("Mốc cụm từ được ước lượng từ speech/VAD khi có hoặc thời lượng audio; chưa căn từng từ. Nghe ở hai đầu trước khi cắt. Áp dụng cắt đồng bộ mọi track và tạo phiên bản con, giữ bản gốc.", "Phrase times are estimated from speech/VAD when available or audio duration; word alignment is unverified. Listen at both boundaries before cutting. Cuts ripple every track and create a child version, preserving the original.")}</p>
    {timeline && <p>{t("Thời lượng", "Duration")}: {time(timeline.duration)} · {t("Timing hiện tại", "Current timing")}: {timeline.captionTiming}</p>}
    {timeline && <CaptionTimingEditor runId={run.id} timeline={timeline} en={en} busy={busy || run.state !== "ready"} call={call} select={select} onSeek={onSeek}/>}
    {error && <p role="alert" className="acs-alert error">{error}</p>}
    {!timeline && !error && <p>{t("Đang tải bản chép lời…", "Loading transcript…")}</p>}
    {timeline && !phrases.length && <p>{t("Phiên bản này chưa có caption timeline để cắt theo lời nói.", "This version has no caption timeline for transcript cuts.")}</p>}
    {!!phrases.length && <><p>{selected.length} {t("cụm đã chọn", "phrases selected")} <button type="button" disabled={!selected.length || applying} onClick={() => { setSelected([]); setReviewed(false); }}>{t("Bỏ chọn", "Clear selection")}</button></p>
      <ol className="acs-transcript">{phrases.map(phrase => <li key={phrase.clipId}>
        <label><input type="checkbox" checked={selected.includes(phrase.clipId)} disabled={busy || applying || run.state !== "ready"} onChange={() => toggle(phrase.clipId)} /> {phrase.text}</label>{" "}
        <button type="button" disabled={!onSeek} onClick={() => onSeek?.(phrase.start)} aria-label={`${t("Nghe từ đầu cụm", "Listen from phrase start")} ${time(phrase.start)}`}>{time(phrase.start)}</button>–<button type="button" disabled={!onSeek} onClick={() => onSeek?.(phrase.end)} aria-label={`${t("Nghe từ cuối cụm", "Listen from phrase end")} ${time(phrase.end)}`}>{time(phrase.end)}</button>
        <small className="acs-mono"> {phrase.clipId} · {t("Clip liên quan", "Linked clips")}: {phrase.clipRefs.join(", ") || "—"}</small>
      </li>)}</ol></>}
    {preview.problem && <p role="alert" className="acs-alert error">{problems[preview.problem]}</p>}
    {preview.plan && <div className="acs-panel" aria-live="polite">
      <h4>{t("Xem trước khoảng cắt", "Cut preview")}</h4>
      <p>{time(preview.plan.durationBefore)} → {time(preview.plan.durationAfter)} · {t("Xóa", "Remove")} {preview.plan.removedSeconds.toFixed(2)}s</p>
      <ul>{preview.plan.ranges.map(range => <li key={range.start}>{time(range.start)}–{time(range.end)}</li>)}</ul>
      <p><b>{t("Lời bị xóa", "Removed wording")}</b>: {preview.plan.removed.map(phrase => phrase.text).join(" ")}</p>
      <p><b>{t("Lời giữ lại, nguyên văn", "Retained wording, unchanged")}</b>: {preview.plan.retained.map(phrase => phrase.text).join(" ")}</p>
      <p className="acs-alert">{t("Cắt lời có thể làm đổi nghĩa hoặc thiếu bối cảnh và điều kiện của một khẳng định. Hệ thống không viết lại lời hay xác nhận ý nghĩa sau cắt.", "Removing speech can change meaning or remove context and qualifications from a claim. The system does not rewrite wording or verify the resulting meaning.")}</p>
      {!!preview.plan.sentenceBoundaryWarnings.length && <p role="alert" className="acs-alert">{t("Có cụm có thể thuộc câu chưa hoàn chỉnh. Nghe lại câu ở hai bên khoảng cắt; mốc ước lượng có thể cắt mất âm tiết.", "Some selected phrases may be part of an unfinished sentence. Listen to the sentence on both sides; estimated boundaries may clip syllables.")}</p>}
      <label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={applying} /> {t("Tôi đã nghe ranh giới và kiểm tra lời giữ lại không làm sai nghĩa.", "I listened to the boundaries and checked that the retained wording preserves meaning.")}</label>
      <p><button type="button" className="acs-primary" disabled={!reviewed || busy || applying || run.state !== "ready"} onClick={() => void apply()}>{applying ? t("Đang tạo phiên bản…", "Creating version…") : t("Cắt và tạo phiên bản mới", "Cut and create new version")}</button></p>
    </div>}
  </section>;
}
