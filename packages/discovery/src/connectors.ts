import * as fs from "node:fs/promises";
import { FactoryError } from "@ttm/core";
import { z } from "zod";

export const ConnectorCapability = z.enum(["api", "rss", "webPublic", "browserManualLogin", "userImport", "downloadAuthorized", "metadataOnly", "unsupported"]);
export type ConnectorCapability = z.infer<typeof ConnectorCapability>;

export const DiscoveredItem = z.object({
  source: z.string(),
  originId: z.string(),
  sourceUrl: z.string().url(),
  title: z.string(),
  description: z.string().default(""),
  creatorDisplayName: z.string().nullable().default(null),
  /** null when not visible — never invented */
  observedFollowerCount: z.number().int().nullable().default(null),
  observedAt: z.string(),
  sourceLanguage: z.string().default("und"),
  thumbnailUrl: z.string().nullable().default(null),
  mediaUrl: z.string().nullable().default(null),
  /** what the source/terms say about downloading this media */
  downloadPermission: z.enum(["allowed_by_license", "owned", "not_granted", "unknown"]).default("unknown"),
  license: z.string().nullable().default(null),
  userNotes: z.string().nullable().default(null),
});
export type DiscoveredItem = z.infer<typeof DiscoveredItem>;

export type SourcePolicy = {
  sourceId: string;
  /** Has the owner reviewed this source's ToS/robots and confirmed automation is permitted? */
  automationPermitted: boolean;
  officialApi: string | null;
  reviewedAt: string | null;
  maxPagesPerRun: number;
  minDelayMs: number;
  notes: string;
};

export type DiscoverEvent = { level: "info" | "warn" | "action"; code: string; message: string };

export interface SourceConnector {
  readonly id: string;
  capabilities(): ConnectorCapability[];
  discover(query: string, ctx: { now: Date; maxItems: number }): Promise<{ items: DiscoveredItem[]; events: DiscoverEvent[]; via: ConnectorCapability }>;
}

/** Owner-supplied list (URLs + notes + files they may use). Always available, the ladder's lawful floor. */
export class UserImportConnector implements SourceConnector {
  readonly id = "user-import";
  constructor(private readonly file: string) {}
  capabilities(): ConnectorCapability[] {
    return ["userImport"];
  }
  async discover(_q: string, ctx: { now: Date; maxItems: number }) {
    const raw = JSON.parse(await fs.readFile(this.file, "utf8"));
    const items = z.array(DiscoveredItem.partial({ observedAt: true })).parse(raw).slice(0, ctx.maxItems);
    return { items: items.map((i) => DiscoveredItem.parse({ ...i, observedAt: i.observedAt ?? ctx.now.toISOString() })), events: [], via: "userImport" as const };
  }
}

/** RSS/Atom feeds the publisher offers for syndication. Bounded and polite. */
export class RssConnector implements SourceConnector {
  constructor(
    readonly id: string,
    private readonly feedUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  capabilities(): ConnectorCapability[] {
    return ["rss", "metadataOnly"];
  }
  async discover(_q: string, ctx: { now: Date; maxItems: number }) {
    const res = await this.fetchImpl(this.feedUrl, { headers: { "user-agent": "TuToMoFactory/0.1 (RSS reader)" } }).catch((e) => {
      throw new FactoryError("NETWORK", "RETRYABLE", `RSS ${this.id}: ${e.message}`);
    });
    if (res.status === 429 || res.status >= 500) throw new FactoryError("SOURCE_HTTP", "RETRYABLE", `RSS ${this.id}: HTTP ${res.status}`);
    if (!res.ok) throw new FactoryError("SOURCE_HTTP", "PERMANENT", `RSS ${this.id}: HTTP ${res.status}`);
    const xml = await res.text();
    const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) ?? [];
    const tag = (b: string, t: string) => {
      const m = new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(b);
      return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1").replace(/<[^>]+>/g, "").trim() : "";
    };
    const items = blocks.slice(0, ctx.maxItems).map((b, i) => {
      const link = tag(b, "link") || /<link[^>]*href="([^"]+)"/.exec(b)?.[1] || "";
      return DiscoveredItem.parse({
        source: this.id,
        originId: tag(b, "guid") || tag(b, "id") || `${this.id}-${i}`,
        sourceUrl: link,
        title: tag(b, "title"),
        description: tag(b, "description") || tag(b, "summary"),
        creatorDisplayName: tag(b, "author") || tag(b, "dc:creator") || null,
        observedAt: ctx.now.toISOString(),
        downloadPermission: "unknown",
      });
    });
    return { items, events: [], via: "rss" as const };
  }
}

/** Minimal page-driver contract so the browser connector can be tested without a real browser. */
export interface PageDriver {
  open(url: string): Promise<void>;
  /** Detect anti-automation / auth walls. */
  detectWall(): Promise<null | "captcha" | "login" | "challenge" | "geo_blocked" | "app_required">;
  extractListing(): Promise<{ originId: string; url: string; title: string; creator: string | null; followers: number | null; description: string; thumbnail: string | null }[]>;
  scrollNext(): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * Browser-assisted discovery for public pages ONLY when the owner has reviewed the source policy
 * and set automationPermitted=true. Stops immediately at any CAPTCHA/login/challenge — never
 * solves or evades it. Extracts metadata only; never downloads media.
 */
export class BrowserPublicConnector implements SourceConnector {
  constructor(
    readonly id: string,
    private readonly policy: SourcePolicy,
    private readonly driverFactory: () => Promise<PageDriver>,
    private readonly searchUrl: (q: string) => string,
  ) {}
  capabilities(): ConnectorCapability[] {
    return this.policy.automationPermitted ? ["webPublic", "metadataOnly"] : ["unsupported"];
  }
  async discover(q: string, ctx: { now: Date; maxItems: number }) {
    if (!this.policy.automationPermitted)
      throw new FactoryError("BLOCKED_POLICY", "BLOCKED", `${this.id}: chưa xác nhận điều khoản cho phép tự động hóa — dùng USER_EXPORT/MANUAL_IMPORT`, {
        manualFallback: "MANUAL_IMPORT",
        nextAction: "Xem SOURCE_CAPABILITIES.md; tự xem trang và nhập URL + ghi chú qua Topic Inbox",
      });
    const events: DiscoverEvent[] = [];
    const items: DiscoveredItem[] = [];
    const seen = new Set<string>();
    const driver = await this.driverFactory();
    try {
      await driver.open(this.searchUrl(q));
      for (let page = 0; page < this.policy.maxPagesPerRun && items.length < ctx.maxItems; page++) {
        const wall = await driver.detectWall();
        if (wall) {
          events.push({ level: "action", code: "USER_ACTION_REQUIRED", message: `${this.id}: gặp ${wall} — dừng ngay, không vượt rào. Hãy tự mở trang và đăng nhập/xác minh nếu bạn muốn.` });
          throw new FactoryError("USER_ACTION_REQUIRED", "HUMAN_REQUIRED", `${this.id}: gặp ${wall}, đã dừng tác vụ trình duyệt`, { manualFallback: "MANUAL_IMPORT" });
        }
        let newOnPage = 0;
        for (const r of await driver.extractListing()) {
          if (seen.has(r.originId)) continue; // pagination duplicates
          seen.add(r.originId);
          newOnPage++;
          items.push(
            DiscoveredItem.parse({
              source: this.id,
              originId: r.originId,
              sourceUrl: r.url,
              title: r.title,
              description: r.description,
              creatorDisplayName: r.creator,
              observedFollowerCount: r.followers,
              observedAt: ctx.now.toISOString(),
              thumbnailUrl: r.thumbnail,
              sourceLanguage: /[一-鿿]/.test(r.title) ? "zh" : "und",
              downloadPermission: "not_granted",
            }),
          );
          if (items.length >= ctx.maxItems) break;
        }
        if (newOnPage === 0) {
          events.push({ level: "info", code: "PAGINATION_EXHAUSTED", message: `${this.id}: không có mục mới ở trang ${page + 1}, dừng` });
          break;
        }
        await new Promise((r) => setTimeout(r, this.policy.minDelayMs));
        if (!(await driver.scrollNext())) break;
      }
    } finally {
      await driver.close();
    }
    return { items, events, via: "webPublic" as const };
  }
}

/** Default policy matrix: China platforms are NOT automation-permitted until the owner reviews terms. */
export const DEFAULT_SOURCE_POLICIES: SourcePolicy[] = [
  { sourceId: "taobao", automationPermitted: false, officialApi: "Taobao Open Platform (cần tài khoản nhà phát triển/được duyệt)", reviewedAt: null, maxPagesPerRun: 3, minDelayMs: 4000, notes: "Có cơ chế chống bot/CAPTCHA; mặc định chỉ USER_EXPORT/MANUAL_IMPORT." },
  { sourceId: "douyin", automationPermitted: false, officialApi: "Douyin Open Platform (giới hạn cho đối tác)", reviewedAt: null, maxPagesPerRun: 3, minDelayMs: 4000, notes: "Video không có quyền tải lại; chỉ lấy ý tưởng." },
  { sourceId: "xiaohongshu", automationPermitted: false, officialApi: null, reviewedAt: null, maxPagesPerRun: 3, minDelayMs: 5000, notes: "Yêu cầu đăng nhập phổ biến; dừng khi gặp tường đăng nhập." },
  { sourceId: "bilibili", automationPermitted: false, officialApi: "Một số API công khai không chính thức — không dùng endpoint không được phép", reviewedAt: null, maxPagesPerRun: 3, minDelayMs: 3000, notes: "Một số video có giấy phép CC do tác giả chọn — kiểm tra từng video." },
];
