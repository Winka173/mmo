import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Google OAuth for installed apps (loopback redirect + PKCE). Listens on 127.0.0.1 only,
 * single request, then closes. Returns a refresh token to be stored via SecretStore.
 */
export async function googleLoopbackAuth(opts: {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  onUrl: (url: string) => void;
  timeoutMs?: number;
}): Promise<{ refreshToken: string; scope: string }> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (u.searchParams.get("state") !== state) {
        res.writeHead(400).end("state không khớp");
        return;
      }
      const code = u.searchParams.get("code");
      if (!code) {
        res.writeHead(400).end(`Bị từ chối: ${u.searchParams.get("error")}`);
        server.close();
        reject(new Error(`OAuth bị từ chối: ${u.searchParams.get("error")}`));
        return;
      }
      try {
        const port = (server.address() as AddressInfo).port;
        const tr = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: opts.clientId,
            client_secret: opts.clientSecret,
            redirect_uri: `http://127.0.0.1:${port}`,
            grant_type: "authorization_code",
            code_verifier: verifier,
          }),
        });
        const j: any = await tr.json();
        if (!tr.ok || !j.refresh_token) throw new Error(`Không nhận được refresh token: ${j.error ?? tr.status}`);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<h2>Đã kết nối YouTube. Bạn có thể đóng tab này.</h2>");
        resolve({ refreshToken: j.refresh_token, scope: j.scope });
      } catch (e) {
        res.writeHead(500).end("Lỗi đổi mã OAuth");
        reject(e);
      } finally {
        server.close();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: `http://127.0.0.1:${port}`,
        response_type: "code",
        scope: opts.scopes.join(" "),
        access_type: "offline",
        prompt: "consent",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
      }).toString();
      opts.onUrl(url.toString());
    });
    setTimeout(() => {
      server.close();
      reject(new Error("Hết thời gian chờ đăng nhập OAuth"));
    }, opts.timeoutMs ?? 5 * 60_000).unref();
  });
}
