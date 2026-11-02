"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { StudioProject } from "../../../../packages/automation/src/studio-projects";
import PronunciationEditor from "./PronunciationEditor";

type Defaults = StudioProject["defaults"];
type Draft = Pick<StudioProject, "name" | "kind" | "defaults"> & Partial<Pick<StudioProject, "id" | "revision">>;
const languages = ["vi-VN", "en-US", "en-GB"] as const;
const kinds = ["game", "brand", "topic", "partner", "custom"] as const;
const blank = (): Draft => ({ name: "", kind: "custom", defaults: { languages: ["vi-VN"], audience: "", tone: "clear", brief: "", sourceFolder: "", pronunciation: [] } });

export default function StudioProjects({ en }: { en: boolean }) {
  const t = (vi: string, eng: string) => en ? eng : vi;
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<Record<string, StudioProject[]>>({});
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false), [created, setCreated] = useState<string | null>(null);
  const kindLabel = (kind: StudioProject["kind"]) => ({ game: t("Trò chơi", "Game"), brand: t("Thương hiệu / Sản phẩm", "Brand / Product"), topic: t("Chủ đề kiến thức", "Knowledge topic"), partner: t("Đối tác sáng tạo", "Creator partner"), custom: t("Tùy chỉnh", "Custom") }[kind]);
  const languageLabel = (language: string) => ({ "vi-VN": t("Tiếng Việt", "Vietnamese"), "en-US": t("Tiếng Anh (Mỹ)", "English (US)"), "en-GB": t("Tiếng Anh (Anh)", "English (UK)") }[language] ?? language);

  const api = useCallback(async (path = "", body?: unknown) => {
    const response = await fetch(`/api/studio/projects${path}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) {
      const messages: Record<string, [string, string]> = {
        conflict: ["Hồ sơ đã được sửa ở cửa sổ khác. Tải lại hồ sơ trước khi lưu.", "This profile changed in another window. Reload the profile before saving."],
        not_found: ["Không tìm thấy dự án hoặc phiên bản đã chọn.", "The selected project or revision was not found."],
        invalid_input: ["Kiểm tra tên, ngôn ngữ và các mục phát âm. Mỗi ngôn ngữ và cách viết chỉ được xuất hiện một lần.", "Check the name, languages and pronunciation entries. Each language and spelling must be unique."],
        invalid_origin: ["Nguồn yêu cầu không hợp lệ. Mở Studio từ địa chỉ local.", "Invalid request origin. Open Studio from its local address."],
        storage_error: ["Không thể đọc hoặc lưu hồ sơ. Kiểm tra thư mục dữ liệu rồi thử lại.", "Cannot read or save profiles. Check the data folder and retry."],
      };
      throw Object.assign(new Error(messages[value.code]?.[en ? 1 : 0] ?? t("Không thể xử lý yêu cầu.", "The request could not be completed.")), { code: value.code });
    }
    return value;
  }, [en]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void api().then(value => { if (active) setProjects(value.projects); }).catch(reason => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api]);

  const defaults = (value: Partial<Defaults>) => setDraft(current => current ? { ...current, defaults: { ...current.defaults, ...value } } : null);
  const attempt = async (work: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice(""); setCreated(null);
    try { await work(); } catch (reason) {
      const failure = reason as Error & { code?: string };
      setError(failure.message || t("Không thể kết nối Studio.", "Cannot connect to Studio."));
      if (failure.code === "conflict") setConflict(true);
    } finally { setBusy(false); }
  };
  const createAutopilot = (project: StudioProject) => attempt(async () => {
    const autopilot = await api("", { action: "create-autopilot", projectId: project.id, revision: project.revision });
    setCreated(autopilot.id);
    setNotice(t("Đã tạo Autopilot ở chế độ bản nháp. Mở thiết lập để kiểm tra nguồn và hoàn tất 7 bước.", "A draft Autopilot was created. Open setup to check sources and complete the 7 steps."));
  });

  return <div>
    <section className="acs-panel">
      <header><h2>{t("Hồ sơ dự án & thương hiệu", "Project & brand profiles")}</h2><button className="acs-primary" disabled={busy || !!draft || loading} onClick={() => { setDraft(blank()); setConflict(false); setError(""); setNotice(""); setCreated(null); }}>{t("Thêm dự án", "Add project")}</button></header>
      <p>{t("Lưu ngôn ngữ, đối tượng và định hướng nội dung một lần để dùng cho các Autopilot mới. Dành cho game, thương hiệu, chủ đề hoặc đối tác của bạn.", "Save languages, audience and creative direction once for new Autopilots. Use profiles for your games, brands, topics or partners.")}</p>
      <p className="acs-muted">{t("Sửa hồ sơ chỉ áp dụng khi tạo Autopilot mới. Quyền sử dụng nguồn và quyền đăng bài được thiết lập riêng trong từng Autopilot.", "Profile edits apply when creating a new Autopilot. Source rights and posting permission are configured separately in each Autopilot.")}</p>
      <Link href="/games">{t("Mở thư viện game & tài sản hiện có →", "Open existing game & asset library →")}</Link>
    </section>
    {error && <div className="acs-alert error" role="alert">{error}</div>}
    {notice && <div className="acs-alert" role="status">{notice} {created && <Link href={`/studio/autopilots?id=${created}`}>{t("Mở thiết lập Autopilot →", "Open Autopilot setup →")}</Link>}</div>}
    {loading && <p role="status">{t("Đang tải hồ sơ…", "Loading profiles…")}</p>}
    {!loading && !projects.length && !draft && <section className="acs-panel acs-empty"><h3>{t("Bắt đầu với dự án của bạn", "Start with your project")}</h3><p>{t("Chỉ cần tên và loại dự án. Các mặc định khác có thể bổ sung sau.", "Start with a name and project type. You can add other defaults later.")}</p></section>}
    {draft && <form className="acs-panel" onSubmit={event => {
      event.preventDefault();
      if (!draft.defaults.languages.length) { setError(t("Chọn ít nhất một ngôn ngữ.", "Choose at least one language.")); return; }
      if (draft.defaults.pronunciation.some(entry => !entry.term.trim() || !entry.spoken.trim())) { setError(t("Điền cách viết và cách đọc cho mỗi mục phát âm.", "Fill in the spelling and spoken form for each pronunciation entry.")); return; }
      void attempt(async () => {
        const saved: StudioProject = await api("", { action: "save", value: draft });
        setProjects(current => [saved, ...current.filter(project => project.id !== saved.id)]);
        setHistory(current => { const next = { ...current }; delete next[saved.id]; return next; });
        setDraft(null); setConflict(false);
        setNotice(t(`Đã lưu hồ sơ, phiên bản ${saved.revision}. Các Autopilot hiện có giữ nguyên.`, `Profile revision ${saved.revision} saved. Existing Autopilots retain their settings.`));
      });
    }}>
      <h2>{draft.id ? t("Chỉnh sửa hồ sơ", "Edit profile") : t("Dự án mới", "New project")}{draft.revision ? ` · ${t("Phiên bản", "Revision")} ${draft.revision}` : ""}</h2>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
        <div className="acs-form-grid">
          <label className="acs-field">{t("Tên dự án", "Project name")}<input required autoFocus maxLength={160} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder={t("Tên game, thương hiệu hoặc chủ đề", "Game, brand or topic name")}/></label>
          <label className="acs-field">{t("Loại dự án", "Project type")}<select aria-label={t("Loại dự án", "Project type")} value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as Draft["kind"] })}>{kinds.map(kind => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}</select></label>
        </div>
        <fieldset><legend>{t("Ngôn ngữ nội dung mặc định", "Default content languages")}</legend><div className="acs-actions">{languages.map(language => <label className="acs-check" key={language}><input type="checkbox" checked={draft.defaults.languages.includes(language)} onChange={event => defaults({ languages: event.target.checked ? [...draft.defaults.languages, language] : draft.defaults.languages.filter(value => value !== language) })}/>{languageLabel(language)}</label>)}</div></fieldset>
        <div className="acs-form-grid">
          <label className="acs-field">{t("Đối tượng khán giả", "Audience")}<input maxLength={2000} value={draft.defaults.audience} onChange={event => defaults({ audience: event.target.value })} placeholder={t("Ví dụ: người mới tìm hiểu chủ đề", "For example: people new to the topic")}/></label>
          <label className="acs-field">{t("Giọng điệu", "Tone")}<input maxLength={1000} value={draft.defaults.tone} onChange={event => defaults({ tone: event.target.value })} placeholder={t("Rõ ràng, thân thiện", "Clear and friendly")}/></label>
        </div>
        <label className="acs-field">{t("Thông tin đã xác minh & định hướng nội dung", "Verified information & creative direction")}<textarea rows={5} maxLength={30000} value={draft.defaults.brief} onChange={event => defaults({ brief: event.target.value })} placeholder={t("Mô tả điều đã biết từ tài liệu nguồn và điều bạn muốn truyền tải.", "Describe what your source material establishes and what you want to communicate.")}/></label>
        <label className="acs-field">{t("Thư mục nguồn mặc định (tùy chọn)", "Default source folder (optional)")}<input maxLength={4096} value={draft.defaults.sourceFolder} onChange={event => defaults({ sourceFolder: event.target.value })} placeholder="C:\Media\My project"/><small className="acs-muted">{t("Nhập đường dẫn đầy đủ trên máy này. Hồ sơ chỉ lưu đường dẫn; quyền dùng từng nguồn cần kiểm tra trong Autopilot.", "Enter the full path on this machine. The profile stores the path; check permission for each source in Autopilot setup.")}</small></label>
        <PronunciationEditor en={en} draft={draft.defaults} update={value => defaults({ pronunciation: value.pronunciation ?? draft.defaults.pronunciation })}/>
        <div className="acs-actions"><button className="acs-primary" disabled={busy || conflict}>{t("Lưu hồ sơ", "Save profile")}</button><button type="button" onClick={() => { setDraft(null); setConflict(false); setError(""); }}>{t("Hủy chỉnh sửa", "Cancel editing")}</button>{conflict && draft.id && <button type="button" onClick={() => void attempt(async () => {
          const value = await api(`?id=${draft.id}`), project: StudioProject = value.project;
          setDraft({ id: project.id, revision: project.revision, name: project.name, kind: project.kind, defaults: project.defaults });
          setProjects(current => current.map(row => row.id === project.id ? project : row));
          setHistory(current => ({ ...current, [project.id]: value.history })); setConflict(false);
          setNotice(t("Đã tải lại hồ sơ mới nhất; bản sửa chưa lưu đã được thay thế.", "Latest profile loaded; unsaved edits were replaced."));
        })}>{t("Tải lại hồ sơ mới nhất (bỏ bản sửa chưa lưu)", "Reload latest profile (discard unsaved edits)")}</button>}</div>
      </fieldset>
    </form>}
    <div className="acs-card-grid">{projects.map(project => <section className="acs-panel" key={project.id}>
      <span className="acs-eyebrow">{kindLabel(project.kind)} · {t("Phiên bản", "Revision")} {project.revision}</span><h2>{project.name}</h2>
      <p>{project.defaults.languages.map(languageLabel).join(" / ")}</p>
      {project.defaults.audience && <p>{t("Khán giả", "Audience")}: {project.defaults.audience}</p>}
      {project.defaults.brief && <p className="acs-clamp">{project.defaults.brief}</p>}
      <div className="acs-actions">
        <button disabled={busy || !!draft} onClick={() => { setDraft({ id: project.id, revision: project.revision, name: project.name, kind: project.kind, defaults: structuredClone(project.defaults) }); setError(""); setNotice(""); setCreated(null); setConflict(false); }}>{t("Chỉnh sửa", "Edit")}</button>
        <button className="acs-primary" disabled={busy || !!draft} onClick={() => void createAutopilot(project)}>{t("Tạo Autopilot từ hồ sơ", "Create Autopilot from profile")}</button>
        <button disabled={busy} onClick={() => void attempt(async () => {
          if (history[project.id]) { setHistory(current => { const next = { ...current }; delete next[project.id]; return next; }); return; }
          const value = await api(`?id=${project.id}`); setHistory(current => ({ ...current, [project.id]: value.history }));
        })}>{history[project.id] ? t("Ẩn lịch sử", "Hide history") : t("Lịch sử hồ sơ", "Profile history")}</button>
      </div>
      {history[project.id] && <div>{history[project.id].slice().reverse().map(revision => <details key={revision.revision}>
        <summary>{t("Phiên bản", "Revision")} {revision.revision} · {new Date(revision.updatedAt).toLocaleString(en ? "en-US" : "vi-VN")}</summary>
        <p><b>{revision.name}</b> · {kindLabel(revision.kind)}</p>
        <dl><dt>{t("Ngôn ngữ", "Languages")}</dt><dd>{revision.defaults.languages.map(languageLabel).join(" / ")}</dd><dt>{t("Khán giả", "Audience")}</dt><dd>{revision.defaults.audience || "—"}</dd><dt>{t("Giọng điệu", "Tone")}</dt><dd>{revision.defaults.tone || "—"}</dd><dt>{t("Thông tin & định hướng", "Brief")}</dt><dd style={{ whiteSpace: "pre-wrap" }}>{revision.defaults.brief || "—"}</dd><dt>{t("Thư mục nguồn", "Source folder")}</dt><dd className="acs-wrap">{revision.defaults.sourceFolder || "—"}</dd><dt>{t("Phát âm", "Pronunciations")}</dt><dd>{revision.defaults.pronunciation.length ? revision.defaults.pronunciation.map((entry, index) => <p key={index}>{languageLabel(entry.language)}: {entry.term} → {entry.spoken}</p>) : "—"}</dd></dl>
      </details>)}</div>}
    </section>)}</div>
  </div>;
}
