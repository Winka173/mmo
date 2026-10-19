import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FactoryError } from "@ttm/core";

type FetchLike = typeof fetch;

export const TELEGRAM_TEXT_LIMIT = 4096;
/** Bot API upload limit for sendVideo/sendDocument via multipart. */
export const TELEGRAM_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;

export function chunkText(text: string, limit = TELEGRAM_TEXT_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) out.push(rest);
  return out;
}

/** Thin Bot API client over HTTPS. The token is only ever placed in the request URL, never logged. */
export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async call(method: string, body: Record<string, unknown> | FormData): Promise<any> {
    const isForm = body instanceof FormData;
    let res: Response;
    try {
      res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        headers: isForm ? undefined : { "content-type": "application/json" },
        body: isForm ? body : JSON.stringify(body),
      });
    } catch (e: any) {
      throw new FactoryError("TG_NETWORK", "RETRYABLE", `Telegram không kết nối được: ${e?.message}`);
    }
    const j: any = await res.json().catch(() => ({}));
    if (j.ok) return j.result;
    if (res.status === 429) {
      const after = Number(j.parameters?.retry_after ?? 30);
      throw new FactoryError("TG_RATE_LIMIT", "RETRYABLE", `Telegram 429, thử lại sau ${after}s`, { retryAfter: new Date(Date.now() + after * 1000).toISOString() });
    }
    if (res.status === 403) throw new FactoryError("TG_BLOCKED", "HUMAN_REQUIRED", "Bot bị chặn hoặc chat không tồn tại (403)");
    if (res.status === 401) throw new FactoryError("TG_UNAUTHORIZED", "HUMAN_REQUIRED", "Token Telegram không hợp lệ (401)");
    if (res.status === 413) throw new FactoryError("TG_TOO_LARGE", "PERMANENT", "File quá lớn cho Bot API (413)");
    throw new FactoryError("TG_ERROR", res.status >= 500 ? "RETRYABLE" : "PERMANENT", `Telegram lỗi ${res.status}: ${j.description ?? ""}`);
  }

  getMe() {
    return this.call("getMe", {});
  }

  async sendMessage(chatId: string, text: string): Promise<number[]> {
    const ids: number[] = [];
    for (const part of chunkText(text)) {
      const r = await this.call("sendMessage", { chat_id: chatId, text: part, disable_web_page_preview: true });
      ids.push(r.message_id);
    }
    return ids;
  }

  private async sendFile(method: "sendPhoto" | "sendVideo" | "sendDocument", field: string, chatId: string, file: string, caption?: string): Promise<number> {
    const st = await fs.stat(file);
    if (st.size > TELEGRAM_UPLOAD_LIMIT_BYTES) throw new FactoryError("TG_TOO_LARGE", "PERMANENT", `File ${path.basename(file)} vượt giới hạn upload của Bot API`);
    const form = new FormData();
    form.set("chat_id", chatId);
    if (caption) form.set("caption", caption.slice(0, 1024));
    form.set(field, new Blob([await fs.readFile(file)]), path.basename(file));
    const r = await this.call(method, form);
    return r.message_id;
  }
  sendPhoto(chatId: string, file: string, caption?: string) {
    return this.sendFile("sendPhoto", "photo", chatId, file, caption);
  }
  sendVideo(chatId: string, file: string, caption?: string) {
    return this.sendFile("sendVideo", "video", chatId, file, caption);
  }
  sendDocument(chatId: string, file: string, caption?: string) {
    return this.sendFile("sendDocument", "document", chatId, file, caption);
  }

  /** Long polling — no inbound port is opened on this machine. */
  getUpdates(offset: number, timeoutSec = 25): Promise<any[]> {
    return this.call("getUpdates", { offset, timeout: timeoutSec, allowed_updates: ["message"] });
  }
}
