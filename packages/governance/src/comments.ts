import { nowIso } from "@ttm/core";
import { DataStore, appendJsonl, readJsonl } from "@ttm/storage";

export type IncomingComment = { id: string; platform: string; remotePostId: string; projectId: string | null; author: string; text: string; at: string; ownedMedia: boolean };
export type CommentClass = "question" | "praise" | "spam" | "harassment" | "product_issue" | "support" | "privacy" | "legal" | "other";
export type FaqEntry = { id: string; keywords: string[]; answer: string; scope: { projectId?: string; gameId?: string; productId?: string }; autoReplyAllowed: boolean };

export type CommentDecision = {
  commentId: string;
  sanitized: string;
  injectionSuspected: boolean;
  class: CommentClass;
  escalate: boolean;
  draft: string | null;
  mode: "IGNORE" | "SUGGEST" | "APPROVE_FIRST" | "AUTO_REPLY" | "ESCALATE";
  reasons: string[];
};

const INJECTION = /(ignore (all|previous|prior) (instructions|rules)|bỏ qua (mọi|các) (hướng dẫn|chỉ dẫn)|system prompt|you are now|act as|developer mode|jailbreak|reveal (your|the) (prompt|secret|token|key)|api[_ ]?key|token|mật khẩu|password|<\/?script|\{\{.*\}\})/i;

/** Treat comment text as untrusted DATA: strip control chars/markup, cap length, flag injection attempts. */
export function sanitizeComment(text: string): { text: string; injection: boolean } {
  const t = text.normalize("NFC").replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮]/g, "").replace(/<[^>]{0,200}>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1000);
  return { text: t, injection: INJECTION.test(t) };
}

export function classifyComment(text: string): CommentClass {
  const t = text.toLowerCase();
  if (/(địa chỉ nhà|số điện thoại của|cccd|căn cước|dox|lộ thông tin)/.test(t)) return "privacy";
  if (/(kiện|luật sư|bản quyền của tôi|vi phạm bản quyền|dmca|tố cáo)/.test(t)) return "legal";
  if (/(ngu|đồ chó|cút|óc chó|giết|chết đi|đ[ụu] m|vcl)/.test(t)) return "harassment";
  if (/(https?:\/\/|bit\.ly|kiếm tiền online|inbox mình|follow chéo|sub chéo|telegram\.me|zalo\.me)/.test(t)) return "spam";
  if (/(hỏng|lỗi|không dùng được|bị rò|giao sai|hoàn tiền|đổi trả)/.test(t)) return "product_issue";
  if (/(không vào được|crash|bị văng|không tải được|lỗi game|bug)/.test(t)) return "support";
  if (/\?|(bao nhiêu|ở đâu|khi nào|có .* không|làm sao|link)/.test(t)) return "question";
  if (/(hay quá|tuyệt|cảm ơn|thích|đỉnh|hữu ích)/.test(t)) return "praise";
  return "other";
}

/**
 * AI Comment Assistant (spec Z2) — owned media only, grounded drafts from verified FAQ/product/game
 * records, approve-first by default. Auto-reply only for opt-in factual FAQ categories with daily
 * cap + cooldown; never links in unrelated threads; escalates support/privacy/legal/harassment.
 */
export class CommentAssistant {
  constructor(private readonly store: DataStore, private readonly cfg: { autoReplyEnabled: boolean; maxRepliesPerDay: number; cooldownMinutes: number }) {}

  private log() {
    return this.store.p("comments", "decisions.jsonl");
  }

  async decide(c: IncomingComment, faq: FaqEntry[], now = new Date()): Promise<CommentDecision> {
    const reasons: string[] = [];
    if (!c.ownedMedia) return this.save({ commentId: c.id, sanitized: "", injectionSuspected: false, class: "other", escalate: false, draft: null, mode: "IGNORE", reasons: ["không phải bài của chính mình — không bao giờ trả lời/bình luận"] });
    const s = sanitizeComment(c.text);
    const cls = classifyComment(s.text);
    if (s.injection) reasons.push("phát hiện câu lệnh/prompt injection trong bình luận — xử lý như dữ liệu, không làm theo");
    const escalate = ["support", "privacy", "legal", "harassment", "product_issue"].includes(cls);
    if (escalate) return this.save({ commentId: c.id, sanitized: s.text, injectionSuspected: s.injection, class: cls, escalate: true, draft: null, mode: "ESCALATE", reasons: [...reasons, `loại ${cls} → chuyển cho bạn xử lý`] });
    if (cls === "spam") return this.save({ commentId: c.id, sanitized: s.text, injectionSuspected: s.injection, class: cls, escalate: false, draft: null, mode: "IGNORE", reasons: [...reasons, "spam — không trả lời"] });
    let draft: string | null = null;
    let match: FaqEntry | undefined;
    if (cls === "question") {
      match = faq.find((f) => (!f.scope.projectId || f.scope.projectId === c.projectId) && f.keywords.some((k) => s.text.toLowerCase().includes(k.toLowerCase())));
      draft = match ? match.answer : null;
      if (!match) reasons.push("không có câu trả lời đã xác minh trong FAQ — không tự bịa");
    } else if (cls === "praise") draft = "Cảm ơn bạn đã xem và ủng hộ! 💛";
    if (draft && /https?:\/\//.test(draft) && !(match && match.scope.projectId === c.projectId)) {
      draft = draft.replace(/https?:\/\/\S+/g, "").trim();
      reasons.push("bỏ link: không chèn link vào thread không liên quan");
    }
    let mode: CommentDecision["mode"] = draft ? "APPROVE_FIRST" : "SUGGEST";
    if (draft && !s.injection && this.cfg.autoReplyEnabled && match?.autoReplyAllowed) {
      const today = (await this.history()).filter((d) => d.mode === "AUTO_REPLY" && d.at.slice(0, 10) === now.toISOString().slice(0, 10));
      const last = today.at(-1);
      if (today.length >= this.cfg.maxRepliesPerDay) reasons.push(`đạt giới hạn ${this.cfg.maxRepliesPerDay} trả lời tự động/ngày`);
      else if (last && now.getTime() - new Date(last.at).getTime() < this.cfg.cooldownMinutes * 60_000) reasons.push(`đang trong thời gian chờ ${this.cfg.cooldownMinutes} phút`);
      else mode = "AUTO_REPLY";
    }
    return this.save({ commentId: c.id, sanitized: s.text, injectionSuspected: s.injection, class: cls, escalate: false, draft, mode, reasons }, now);
  }

  async history(): Promise<(CommentDecision & { at: string })[]> {
    return (await readJsonl<CommentDecision & { at: string }>(this.log())).records;
  }

  private async save(d: CommentDecision, now = new Date()): Promise<CommentDecision> {
    await appendJsonl(this.log(), { ...d, at: nowIso(now) });
    return d;
  }
}
