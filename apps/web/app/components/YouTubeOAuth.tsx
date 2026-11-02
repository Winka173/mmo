"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { YouTubeOAuthStatus } from "../../../../packages/automation/src/studio-oauth";

type Channel = { id: string; name: string; platform: "youtube_long" | "youtube_shorts"; expectedRemoteId: string; revision: number };
const pending = (phase?: string) => ["awaiting_browser", "awaiting_consent", "exchanging"].includes(phase ?? "");

export default function YouTubeOAuth({ en, channels = [], onConnected }: { en: boolean; channels?: Channel[]; onConnected?: () => void }) {
  const t = (vi: string, eng: string) => en ? eng : vi;
  const [session, setSession] = useState<YouTubeOAuthStatus | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null), [selected, setSelected] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [retrying, setRetrying] = useState(false);
  const connectedNotified = useRef<string | null>(null), connectedCallback = useRef(onConnected);
  connectedCallback.current = onConnected;
  const channel = channels.find(row => row.id === selected);
  const describeError = useCallback((code: string) => {
    const labels: Record<string, [string, string]> = {
      invalid_input: ["Kiểm tra Client ID của ứng dụng Desktop, Client secret và Channel ID bắt đầu bằng UC.", "Check the Desktop app Client ID, client secret and UC channel ID."],
      unauthorized_session: ["Phiên đăng nhập không thuộc cửa sổ này hoặc cookie đã hết hạn. Bắt đầu phiên mới.", "This sign-in belongs to another browser or its cookie expired. Start a new attempt."],
      expired: ["Phiên đăng nhập đã hết hạn. Thử lại để nhận mã bảo vệ mới.", "Sign-in expired. Retry with a fresh security challenge."],
      interrupted: ["Studio đã khởi động lại trong lúc đăng nhập. Thử lại.", "Studio restarted during sign-in. Retry."],
      denied: ["Bạn đã từ chối quyền truy cập tại Google. Kênh chưa được kết nối.", "Google access was declined. The channel was not connected."],
      scope_missing: ["Chưa cấp đủ hai quyền đọc kênh và tải video. Thử lại và kiểm tra quyền trên Google.", "Read-channel and upload permissions were not both granted. Retry and check Google permissions."],
      scope_unexpected: ["Google trả thêm quyền ngoài hai quyền được yêu cầu. Dùng OAuth client Desktop riêng cho Studio rồi thử lại.", "Google returned permissions beyond the two requested. Use a dedicated Desktop OAuth client for Studio and retry."],
      identity_mismatch: ["Kênh Google đã chọn không khớp Channel ID mong đợi. Chọn đúng kênh khi thử lại.", "The selected Google channel does not match the expected channel ID. Select the correct channel when retrying."],
      refresh_missing: ["Google chưa trả refresh token cho truy cập ngoại tuyến. Kiểm tra app Desktop và đồng ý cấp quyền khi thử lại.", "Google did not return an offline refresh token. Check the Desktop app and grant consent when retrying."],
      provider_error: ["Google không hoàn tất trao đổi mã hoặc xác minh kênh. Kiểm tra mạng, bật YouTube Data API v3 và thử lại.", "Google could not exchange the code or verify the channel. Check your network, enable YouTube Data API v3 and retry."],
      channel_changed: ["Cấu hình kênh đã thay đổi. Tải lại trang trước khi kết nối lại.", "Channel configuration changed. Reload the page before reconnecting."],
      browser_error: ["Không mở được trình duyệt hệ thống. Kiểm tra trình duyệt mặc định rồi thử nút mở lần nữa.", "The system browser could not open. Check your default browser and try the open button again."],
      listener_error: ["Không mở được cổng callback local. Kiểm tra tường lửa rồi thử lại.", "The local callback port could not open. Check your firewall and retry."],
      restart_required: ["Phiên này đã được sử dụng hoặc đã dừng. Hủy nếu cần rồi bắt đầu phiên mới.", "This attempt was already used or stopped. Cancel if needed and start a new one."],
      storage_error: ["Không thể lưu kết nối an toàn. Kiểm tra thư mục dữ liệu và Windows DPAPI rồi thử lại.", "The connection could not be saved securely. Check the data folder and Windows DPAPI, then retry."],
    };
    return labels[code]?.[en ? 1 : 0] ?? t("Không thể hoàn tất đăng nhập. Thử lại.", "Sign-in could not be completed. Retry.");
  }, [en]);
  const call = useCallback(async (body?: unknown, id?: string) => {
    const response = await fetch(`/api/studio/oauth${body === undefined ? `?id=${id}` : ""}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw new Error(describeError(value.code));
    return value as YouTubeOAuthStatus;
  }, [describeError]);
  useEffect(() => { setSessionId(sessionStorage.getItem("acs_youtube_oauth")); }, []);
  useEffect(() => {
    if (!sessionId) return;
    let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const value = await call(undefined, sessionId);
        if (!active) return;
        setSession(value);
        if (value.phase === "connected" && connectedNotified.current !== value.id) { connectedNotified.current = value.id; connectedCallback.current?.(); }
        if (pending(value.phase)) timer = setTimeout(() => void poll(), 2000);
      } catch (reason) { if (active) setError((reason as Error).message); }
    };
    void poll(); return () => { active = false; if (timer) clearTimeout(timer); };
  }, [sessionId, call]);
  const act = async (action: "open" | "cancel") => {
    if (!sessionId) return;
    setBusy(true); setError("");
    try { setSession(await call({ action, id: sessionId })); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  const phases: Record<string, string> = {
    awaiting_browser: t("Sẵn sàng mở trình duyệt", "Ready to open the browser"), awaiting_consent: t("Đang chờ bạn cấp quyền tại Google", "Waiting for your consent at Google"),
    exchanging: t("Đang xác minh quyền & danh tính kênh", "Verifying permissions & channel identity"), connected: t("Đã kết nối; kênh vẫn đang tắt", "Connected; channel remains disabled"),
    cancelled: t("Đã hủy đăng nhập", "Sign-in cancelled"), expired: t("Phiên đăng nhập đã hết hạn", "Sign-in expired"), failed: t("Chưa kết nối", "Not connected"), interrupted: t("Phiên đăng nhập bị gián đoạn", "Sign-in interrupted"),
  };
  return <section className="acs-panel">
    <h2>{t("Đăng nhập YouTube bằng trình duyệt", "Sign in to YouTube in your browser")}</h2>
    <p>{t("Nhập OAuth app loại Desktop và Channel ID bạn muốn kết nối. Sau khi chuẩn bị, bấm mở trình duyệt để tự chọn tài khoản và cấp quyền tại Google.", "Enter your Desktop OAuth app and the channel ID you want to connect. After preparing sign-in, open the system browser to choose your account and grant permission at Google.")}</p>
    <p className="acs-muted">{t("Chỉ yêu cầu đọc kênh và tải video; không yêu cầu email, quản lý bình luận hoặc quyền xóa video. Kết nối thành công không bật kênh hay cho phép đăng tự động.", "Requests read-channel and video-upload permissions. Successful sign-in keeps the channel disabled and leaves posting authorization separate.")}</p>
    <details><summary>{t("Chuẩn bị OAuth app lần đầu", "First-time OAuth app setup")}</summary><p>{t("Trong Google Cloud Console, bật YouTube Data API v3, cấu hình màn hình đồng ý OAuth và thêm tài khoản thử nghiệm nếu app đang ở chế độ Testing. Tạo OAuth client loại Desktop app rồi chép Client ID và Client secret vào đây. Google có thể yêu cầu xác minh app; token thử nghiệm có thể hết hạn và cần kết nối lại.", "In Google Cloud Console, enable YouTube Data API v3, configure the OAuth consent screen and add your test user if the app is in Testing. Create a Desktop app OAuth client and copy its client ID and secret here. Google may require app verification; testing tokens may expire and require reconnection.")}</p><a href="https://developers.google.com/identity/protocols/oauth2/native-app" target="_blank" rel="noreferrer">{t("Hướng dẫn chính thức của Google ↗", "Official Google instructions ↗")}</a></details>
    {error && <p className="acs-alert error" role="alert">{error}</p>}
    {session && <div className="acs-panel" aria-live="polite"><h3>{phases[session.phase]}</h3><p>{session.name} · {session.expectedRemoteId}</p>
      {pending(session.phase) && <p>{t("Phiên hết hạn lúc", "Attempt expires at")} {new Date(session.expiresAt).toLocaleTimeString(en ? "en-US" : "vi-VN")}</p>}
      {session.errorCode && <p className="acs-alert error">{describeError(session.errorCode)}</p>}
      {session.phase === "connected" && <><p>{t("Đã xác minh đúng kênh và lưu credential bằng kho mã hóa của máy. Bật kênh riêng khi bạn sẵn sàng.", "Channel identity was verified and credentials were saved in the machine's encrypted store. Enable the channel separately when ready.")}</p><p>{t("Quyền đã cấp", "Granted permissions")}: {session.grantedScopes.map(scope => scope.split("/").at(-1)).join(", ")}</p></>}
      <div className="acs-actions">{session.phase === "awaiting_browser" && !session.browserRequested && <button className="acs-primary" disabled={busy} onClick={() => void act("open")}>{t("Mở trình duyệt hệ thống để đăng nhập", "Open system browser to sign in")}</button>}
        {pending(session.phase) && <button disabled={busy} onClick={() => void act("cancel")}>{t("Hủy đăng nhập", "Cancel sign-in")}</button>}
        {!pending(session.phase) && <button disabled={busy} onClick={() => { setRetrying(session.phase !== "connected"); if (session.phase === "connected") { setSession(null); setSessionId(null); sessionStorage.removeItem("acs_youtube_oauth"); } }}>{session.phase === "connected" ? t("Kết nối kênh khác", "Connect another channel") : t("Nhập thông tin để thử lại", "Enter details to retry")}</button>}
      </div>
    </div>}
    {(!session || retrying) && <form key={`${selected}:${retrying}`} onSubmit={event => {
      event.preventDefault(); const form = event.currentTarget, fields = new FormData(form);
      const value = { name: String(fields.get("name") ?? ""), platform: channel?.platform ?? String(fields.get("platform")), expectedRemoteId: channel?.expectedRemoteId ?? String(fields.get("expectedRemoteId")),
        clientId: String(fields.get("clientId") ?? ""), clientSecret: String(fields.get("clientSecret") ?? ""), locale: en ? "en" : "vi", ...(channel ? { channelId: channel.id, revision: channel.revision } : {}) };
      setBusy(true); setError("");
      void call(retrying && sessionId ? { action: "retry", id: sessionId, value } : { action: "begin", value }).then(next => {
        setSession(next); setSessionId(next.id); setRetrying(false); sessionStorage.setItem("acs_youtube_oauth", next.id); form.reset();
      }).catch(reason => setError(reason.message)).finally(() => setBusy(false));
    }}><fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
      <div className="acs-form-grid">
        <label className="acs-field">{t("Kênh cần kết nối", "Channel to connect")}<select value={selected} onChange={event => setSelected(event.target.value)}><option value="">{t("Tạo kết nối kênh mới", "Create a new channel connection")}</option>{channels.map(row => <option key={row.id} value={row.id}>{row.name} · {row.expectedRemoteId}</option>)}</select></label>
        <label className="acs-field">{t("Tên kết nối YouTube", "YouTube connection name")}<input name="name" required maxLength={160} defaultValue={channel?.name ?? session?.name ?? ""}/></label>
        {!channel && <label className="acs-field">{t("Định dạng kênh", "Channel format")}<select name="platform" defaultValue={session?.platform ?? "youtube_long"}><option value="youtube_long">YouTube video</option><option value="youtube_shorts">YouTube Shorts</option></select></label>}
        <label className="acs-field">{t("YouTube Channel ID mong đợi", "Expected YouTube channel ID")}<input name="expectedRemoteId" required pattern="UC[A-Za-z0-9_-]{22}" defaultValue={channel?.expectedRemoteId ?? session?.expectedRemoteId ?? ""} readOnly={!!channel} placeholder="UC…"/></label>
        <label className="acs-field">{t("OAuth Desktop Client ID", "OAuth Desktop client ID")}<input name="clientId" required maxLength={2000} autoComplete="off" placeholder="…apps.googleusercontent.com"/></label>
        <label className="acs-field">{t("OAuth Desktop Client secret", "OAuth Desktop client secret")}<input name="clientSecret" type="password" required maxLength={2000} autoComplete="new-password"/></label>
      </div><button className="acs-primary" disabled={busy}>{retrying ? t("Chuẩn bị phiên đăng nhập mới", "Prepare a new sign-in attempt") : t("Chuẩn bị đăng nhập YouTube", "Prepare YouTube sign-in")}</button>
      <p className="acs-muted">{t("Nút này chỉ chuẩn bị phiên local; trình duyệt mở khi bạn bấm nút mở ở bước tiếp theo. Hủy hoặc thử lại không xóa credential đang có.", "This prepares a local attempt; the browser opens only when you click the next open button. Cancelling or retrying preserves existing credentials.")}</p>
    </fieldset></form>}
  </section>;
}
