import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { execFile } from "node:child_process";
import * as path from "node:path";
import { z } from "zod";
import { DataStore, readJson, withLock, writeJsonAtomic } from "@ttm/storage";
import { StudioPublishingStore } from "./studio-publishing.js";

// Official protocol references, reviewed 2026-10-23:
// https://developers.google.com/identity/protocols/oauth2/native-app
// https://developers.google.com/youtube/v3/docs/channels/list
export const STUDIO_YOUTUBE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHANNEL_URL = "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true&maxResults=50";
const TTL = 10 * 60_000;
const opaque = () => randomBytes(32).toString("base64url");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const matches = (a: string, b: string) => timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));

export const BeginYouTubeOAuth = z.object({
  name: z.string().trim().min(1).max(160),
  platform: z.enum(["youtube_long", "youtube_shorts"]),
  expectedRemoteId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/),
  clientId: z.string().trim().max(2000).regex(/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/),
  clientSecret: z.string().trim().min(1).max(2000),
  locale: z.enum(["vi", "en"]).default("vi"),
  channelId: z.string().uuid().optional(), revision: z.number().int().positive().optional(),
}).strict();

const Session = z.object({
  id: z.string().uuid(), ownerHash: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string(), platform: z.enum(["youtube_long", "youtube_shorts"]), expectedRemoteId: z.string(),
  channelId: z.string().uuid(), channelRevision: z.number().int().positive().nullable(),
  phase: z.enum(["awaiting_browser", "awaiting_consent", "exchanging", "connected", "cancelled", "expired", "failed", "interrupted"]),
  errorCode: z.string().nullable(), browserRequested: z.boolean(),
  grantedScopes: z.array(z.string()), verifiedRemoteId: z.string().nullable(),
  createdAt: z.string().datetime(), expiresAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
type Session = z.infer<typeof Session>;
export type YouTubeOAuthStatus = Omit<Session, "ownerHash"> & { requiredScopes: readonly string[] };
type OAuthInput = z.infer<typeof BeginYouTubeOAuth>;
type LiveAttempt = {
  store: StudioYouTubeOAuthStore; server: Server; timer: NodeJS.Timeout;
  origin: string; startUrl: string; state: string; verifier: string; ticket: string; callbackCookie: string;
  cookieName: string; input: OAuthInput; claimed: boolean; cancelled: boolean; abort: AbortController;
};
const globals = globalThis as typeof globalThis & { __acsYouTubeOAuth?: Map<string, LiveAttempt> };
const attempts = globals.__acsYouTubeOAuth ??= new Map<string, LiveAttempt>();
const pending = (row: Session) => ["awaiting_browser", "awaiting_consent", "exchanging"].includes(row.phase);

export class StudioOAuthError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}

/** This function is called only by an explicit authenticated UI action. */
async function systemBrowser(url: string) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/oauth\/start\?ticket=[A-Za-z0-9_-]{43}$/.test(url)) throw new StudioOAuthError("invalid_browser_url");
  const command = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "rundll32.exe") : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  await new Promise<void>((resolve, reject) => execFile(command, args, { windowsHide: true, timeout: 10_000 }, error => error ? reject(new StudioOAuthError("browser_error")) : resolve()));
}

function html(res: ServerResponse, status: number, success = false) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Connection": "close",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'", "X-Content-Type-Options": "nosniff",
  });
  res.end(`<!doctype html><html lang="vi"><meta charset="utf-8"><title>YouTube OAuth</title><h1>${success ? "Đã kết nối kênh / Channel connected" : "Chưa kết nối / Not connected"}</h1><p>${success ? "Kênh vẫn đang tắt. Trở lại Studio để tiếp tục. / The channel remains disabled. Return to Studio to continue." : "Trở lại Studio để xem trạng thái hoặc thử lại. / Return to Studio to check the status or retry."}</p></html>`);
}

export class StudioYouTubeOAuthStore {
  constructor(readonly store: DataStore, private readonly opts: {
    fetchImpl?: typeof fetch; openBrowser?: (url: string) => Promise<void>; now?: () => Date;
  } = {}) {}
  private now() { return this.opts.now?.() ?? new Date(); }
  private key(id: string) { return `${this.store.root}\0${id}`; }
  private file(id: string) { z.string().uuid().parse(id); return this.store.p("studio", "oauth", `${id}.json`); }
  private lock(id: string) { z.string().uuid().parse(id); return this.store.p("locks", `studio-oauth-${id}.lock`); }
  private async row(id: string) { return readJson(this.file(id), Session); }
  private async save(row: Session) {
    row = Session.parse({ ...row, updatedAt: this.now().toISOString() });
    await writeJsonAtomic(this.file(row.id), row); return row;
  }
  private public(row: Session): YouTubeOAuthStatus { const { ownerHash: _owner, ...safe } = row; return { ...safe, requiredScopes: STUDIO_YOUTUBE_OAUTH_SCOPES }; }
  private async owned(id: string, owner: string) {
    const row = await this.row(id);
    if (!row || !owner || !matches(row.ownerHash, digest(owner))) throw new StudioOAuthError("unauthorized_session", 403);
    return row;
  }
  private dispose(id: string) {
    const live = attempts.get(this.key(id)); if (!live) return;
    attempts.delete(this.key(id)); clearTimeout(live.timer); live.abort.abort();
    live.cancelled = true; live.state = live.verifier = live.ticket = live.callbackCookie = "";
    live.input.clientId = live.input.clientSecret = "";
    live.server.close(); live.server.closeIdleConnections();
    const force = setTimeout(() => live.server.closeAllConnections(), 2000); force.unref();
  }
  private async terminate(id: string, phase: "cancelled" | "expired") {
    return withLock(this.lock(id), async () => {
      const row = await this.row(id); if (!row) throw new StudioOAuthError("session_missing", 404);
      if (pending(row)) { await this.save({ ...row, phase, errorCode: null }); this.dispose(id); }
      return this.public((await this.row(id))!);
    });
  }

  async begin(input: unknown): Promise<{ session: YouTubeOAuthStatus; ownerToken: string; startUrl: string }> {
    const value = BeginYouTubeOAuth.parse(input), publishing = new StudioPublishingStore(this.store);
    if (value.channelId) {
      const channel = await publishing.channel(value.channelId);
      if (!channel || channel.revision !== value.revision) throw new StudioOAuthError("channel_changed", 409);
      if (channel.expectedRemoteId !== value.expectedRemoteId || channel.platform !== value.platform) throw new StudioOAuthError("identity_mismatch");
    } else if (value.revision !== undefined) throw new StudioOAuthError("channel_changed", 409);
    const id = randomUUID(), ownerToken = opaque(), state = opaque(), verifier = opaque(), ticket = opaque();
    const now = this.now(), row = Session.parse({
      id, ownerHash: digest(ownerToken), name: value.name, platform: value.platform, expectedRemoteId: value.expectedRemoteId,
      channelId: value.channelId ?? randomUUID(), channelRevision: value.revision ?? null,
      phase: "awaiting_browser", browserRequested: false, errorCode: null, grantedScopes: [], verifiedRemoteId: null,
      createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + TTL).toISOString(),
    });
    const server = createServer((req, res) => { void this.callback(id, req, res).catch(() => { if (!res.headersSent) html(res, 500); else res.end(); }); });
    server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 1000;
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); }); }).catch(() => { server.close(); throw new StudioOAuthError("listener_error", 500); });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const live: LiveAttempt = {
      store: this, server, origin, startUrl: `${origin}/oauth/start?ticket=${ticket}`, state, verifier, ticket,
      callbackCookie: opaque(), cookieName: `acs_yt_${id.replace(/-/g, "")}`, input: value,
      claimed: false, cancelled: false, abort: new AbortController(),
      timer: setTimeout(() => { void this.terminate(id, "expired").catch(() => this.dispose(id)); }, TTL),
    };
    live.timer.unref(); server.unref(); attempts.set(this.key(id), live);
    try { await this.save(row); } catch { this.dispose(id); throw new StudioOAuthError("storage_error", 500); }
    return { session: this.public(row), ownerToken, startUrl: live.startUrl };
  }

  async status(id: string, owner: string): Promise<YouTubeOAuthStatus> {
    let row = await this.owned(id, owner);
    if (pending(row)) {
      if (Date.parse(row.expiresAt) <= this.now().getTime()) return this.terminate(id, "expired");
      if (!attempts.has(this.key(id))) row = await withLock(this.lock(id), async () => {
        const current = (await this.row(id))!;
        return pending(current) ? this.save({ ...current, phase: "interrupted", errorCode: "interrupted" }) : current;
      });
    }
    return this.public(row);
  }

  async open(id: string, owner: string) {
    const status = await this.status(id, owner), live = attempts.get(this.key(id));
    if (!live || status.phase !== "awaiting_browser" || status.browserRequested) throw new StudioOAuthError("restart_required", 409);
    await withLock(this.lock(id), async () => {
      const row = (await this.row(id))!;
      if (row.phase !== "awaiting_browser" || row.browserRequested) throw new StudioOAuthError("restart_required", 409);
      await this.save({ ...row, browserRequested: true });
    });
    try { await (this.opts.openBrowser ?? systemBrowser)(live.startUrl); }
    catch {
      await withLock(this.lock(id), async () => { const row = (await this.row(id))!; if (row.phase === "awaiting_browser") await this.save({ ...row, browserRequested: false }); });
      throw new StudioOAuthError("browser_error");
    }
    return this.status(id, owner);
  }

  async cancel(id: string, owner: string) { await this.owned(id, owner); return this.terminate(id, "cancelled"); }
  async retry(id: string, owner: string, input: unknown) {
    // Validate new input before cancelling the previous attempt. Never reuse a state or verifier.
    const value = BeginYouTubeOAuth.parse(input); await this.cancel(id, owner); return this.begin(value);
  }

  private async google(url: string, init: RequestInit, live: LiveAttempt) {
    if (![TOKEN_URL, CHANNEL_URL].includes(url)) throw new StudioOAuthError("provider_error");
    try {
      const response = await (this.opts.fetchImpl ?? fetch)(url, { ...init, redirect: "error", signal: AbortSignal.any([live.abort.signal, AbortSignal.timeout(10_000)]) });
      if (!response.ok || response.redirected) throw new StudioOAuthError("provider_error");
      return await response.json();
    } catch { throw new StudioOAuthError("provider_error"); }
  }

  private async callback(id: string, req: IncomingMessage, res: ServerResponse) {
    const live = attempts.get(this.key(id));
    if (!live || req.socket.remoteAddress !== "127.0.0.1" || req.headers.host !== new URL(live.origin).host) { html(res, 403); return; }
    const url = new URL(req.url ?? "/", live.origin);
    if (req.method !== "GET") { html(res, 405); return; }
    if (url.origin !== live.origin) { html(res, 403); return; }
    const row = await this.row(id);
    if (!row || Date.parse(row.expiresAt) <= this.now().getTime()) { await this.terminate(id, "expired"); html(res, 410); return; }
    if (url.pathname === "/oauth/start") {
      if (row.phase !== "awaiting_browser" || !live.ticket || url.searchParams.getAll("ticket").length !== 1 || !matches(url.searchParams.get("ticket") ?? "", live.ticket)) { html(res, 403); return; }
      live.ticket = "";
      await withLock(this.lock(id), async () => {
        const current = (await this.row(id))!;
        if (current.phase !== "awaiting_browser" || live.cancelled) throw new StudioOAuthError("restart_required");
        await this.save({ ...current, phase: "awaiting_consent" });
      });
      const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      auth.search = new URLSearchParams({ client_id: live.input.clientId, redirect_uri: `${live.origin}/oauth/callback`, response_type: "code",
        scope: STUDIO_YOUTUBE_OAUTH_SCOPES.join(" "), access_type: "offline", prompt: "consent", code_challenge_method: "S256",
        code_challenge: createHash("sha256").update(live.verifier).digest("base64url"), state: live.state }).toString();
      res.writeHead(303, { Location: auth.href, "Set-Cookie": `${live.cookieName}=${live.callbackCookie}; HttpOnly; SameSite=Lax; Path=/oauth/callback; Max-Age=600`,
        "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Connection": "close" }); res.end(); return;
    }
    if (url.pathname !== "/oauth/callback") { html(res, 404); return; }
    const cookies = (req.headers.cookie ?? "").split(";").map(value => value.trim());
    const cookie = cookies.find(value => value.startsWith(`${live.cookieName}=`))?.slice(live.cookieName.length + 1) ?? "";
    if (!live.state || !cookie || !matches(cookie, live.callbackCookie) || url.searchParams.getAll("state").length !== 1 || !matches(url.searchParams.get("state") ?? "", live.state)) { html(res, 403); return; }
    if (row.phase !== "awaiting_consent" || live.claimed) { html(res, 409); return; }
    const code = url.searchParams.get("code"), denied = url.searchParams.get("error");
    if (url.searchParams.getAll("code").length > 1 || url.searchParams.getAll("error").length > 1 || (!!code === !!denied) || code && (code.length > 8192 || /[\r\n]/.test(code))) { html(res, 400); return; }
    live.claimed = true;
    try {
      await withLock(this.lock(id), async () => {
        const current = (await this.row(id))!;
        if (current.phase !== "awaiting_consent" || live.cancelled) throw new StudioOAuthError("restart_required");
        await this.save({ ...current, phase: "exchanging" });
      });
      if (denied) throw new StudioOAuthError("denied");
      const tokens = await this.google(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: live.input.clientId, client_secret: live.input.clientSecret, code: code!, grant_type: "authorization_code", code_verifier: live.verifier, redirect_uri: `${live.origin}/oauth/callback` }) }, live);
      if (typeof tokens.refresh_token !== "string" || !tokens.refresh_token || tokens.refresh_token.length > 8000) throw new StudioOAuthError("refresh_missing");
      if (typeof tokens.access_token !== "string" || !tokens.access_token || tokens.access_token.length > 16000 || tokens.token_type !== "Bearer") throw new StudioOAuthError("provider_error");
      const scopes:string[] = typeof tokens.scope === "string" ? tokens.scope.split(/\s+/).filter(Boolean) : [];
      if (!STUDIO_YOUTUBE_OAUTH_SCOPES.every(scope => scopes.includes(scope))) throw new StudioOAuthError("scope_missing");
      if (scopes.some(scope => !STUDIO_YOUTUBE_OAUTH_SCOPES.includes(scope as typeof STUDIO_YOUTUBE_OAUTH_SCOPES[number]))) throw new StudioOAuthError("scope_unexpected");
      const channels = await this.google(CHANNEL_URL, { headers: { authorization: `Bearer ${tokens.access_token}` } }, live);
      // Match the one-channel identity that the existing publisher validates before each upload.
      if (!Array.isArray(channels.items) || channels.items.length !== 1 || channels.items[0]?.id !== live.input.expectedRemoteId || channels.nextPageToken) throw new StudioOAuthError("identity_mismatch");
      await withLock(this.lock(id), async () => {
        const current = (await this.row(id))!;
        if (current.phase !== "exchanging" || live.cancelled) throw new StudioOAuthError("restart_required");
        if (Date.parse(current.expiresAt) <= this.now().getTime()) throw new StudioOAuthError("expired");
        const channel = await new StudioPublishingStore(this.store).saveChannel({ id: current.channelId, revision: current.channelRevision ?? undefined,
          name: current.name, platform: current.platform, expectedRemoteId: current.expectedRemoteId, enabled: false },
          { clientId: live.input.clientId, clientSecret: live.input.clientSecret, refreshToken: tokens.refresh_token });
        await this.save({ ...current, phase: "connected", channelRevision: channel.revision, grantedScopes: [...new Set(scopes)], verifiedRemoteId: channel.expectedRemoteId, errorCode: null });
      });
      html(res, 200, true);
    } catch (error) {
      const errorCode = error instanceof StudioOAuthError ? error.code : "storage_error";
      await withLock(this.lock(id), async () => {
        const current = await this.row(id);
        if (current && pending(current)) await this.save({ ...current, phase: errorCode === "expired" ? "expired" : "failed", errorCode });
      }).catch(() => undefined);
      html(res, 400);
    } finally { this.dispose(id); }
  }
}
