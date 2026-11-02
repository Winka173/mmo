import { z } from "zod";
import { BeginYouTubeOAuth, StudioOAuthError, StudioYouTubeOAuthStore } from "../../../../../../packages/automation/src/studio-oauth";
import { getStore } from "../../../lib/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const id = z.string().uuid();
const Mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("begin"), value: BeginYouTubeOAuth }).strict(),
  z.object({ action: z.literal("open"), id }).strict(),
  z.object({ action: z.literal("cancel"), id }).strict(),
  z.object({ action: z.literal("retry"), id, value: BeginYouTubeOAuth }).strict(),
]);
const cookieName = (sessionId: string) => `acs_yt_owner_${sessionId.replace(/-/g, "")}`;
function owner(request: Request, sessionId: string) {
  const key = `${cookieName(sessionId)}=`;
  return (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).find(value => value.startsWith(key))?.slice(key.length) ?? "";
}
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...headers } });
function failure(error: unknown) {
  if (error instanceof StudioOAuthError) return json({ code: error.code, error: "YouTube sign-in could not continue / Không thể tiếp tục đăng nhập YouTube" }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ code: "invalid_input", error: "Check the OAuth fields / Kiểm tra thông tin OAuth" }, 400);
  return json({ code: "storage_error", error: "Cannot access OAuth session / Không thể truy cập phiên đăng nhập" }, 500);
}

export async function GET(request: Request) {
  try {
    const sessionId = id.parse(new URL(request.url).searchParams.get("id"));
    return json(await new StudioYouTubeOAuthStore(await getStore()).status(sessionId, owner(request, sessionId)));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const host=request.headers.get("host")??"",url = new URL(`http://${host}`);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || request.headers.get("origin") !== url.origin)
    return json({ code: "invalid_origin", error: "Invalid origin / Nguồn yêu cầu không hợp lệ" }, 403);
  try {
    const body = Mutation.parse(await request.json()), oauth = new StudioYouTubeOAuthStore(await getStore());
    if (body.action === "begin" || body.action === "retry") {
      const result = body.action === "begin" ? await oauth.begin(body.value) : await oauth.retry(body.id, owner(request, body.id), body.value);
      // This private proof authorizes status/cancel/open only. OAuth provider tokens are never returned.
      return json({ ...result.session, startUrl: result.startUrl }, 200, {
        "Set-Cookie": `${cookieName(result.session.id)}=${result.ownerToken}; Path=/api/studio/oauth; HttpOnly; SameSite=Strict; Max-Age=900`,
      });
    }
    return json(body.action === "open" ? await oauth.open(body.id, owner(request, body.id)) : await oauth.cancel(body.id, owner(request, body.id)));
  } catch (error) { return failure(error); }
}
