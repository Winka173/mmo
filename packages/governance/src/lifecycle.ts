import { CLAIM_TTL_HOURS, nowIso } from "@ttm/core";
import { DataStore, readJson, writeJsonAtomic } from "@ttm/storage";
import { z } from "zod";
import type { FetchLike } from "./affiliate.js";
import { SourceLicenseRegistry } from "./rights-registry.js";

export type LifecycleFlag = { at: string; type: string; projectId: string; platform: string | null; detail: string; action: string; canAutoFix: boolean };

/**
 * LifecycleManager (spec Z3): audits PUBLISHED posts for expired/revoked licences, broken CTA
 * links, stale facts/prices, disputed claims, deprecated game features and newer game builds.
 * Produces flags + Telegram-ready summaries. It never edits/withdraws a post itself unless the
 * platform API exposes that action AND the user enabled it — default is a manual task.
 */
export class LifecycleManager {
  constructor(private readonly store: DataStore, private readonly opts: { fetchImpl?: FetchLike; editCapable?: (platform: string) => boolean } = {}) {}

  async audit(now = new Date(), deps: { gameFeatures?: (gameId: string) => Promise<{ name: string; keywords: string[]; status: string }[]>; latestBuild?: (gameId: string) => Promise<string | null> } = {}): Promise<LifecycleFlag[]> {
    const flags: LifecycleFlag[] = [];
    const reg = new SourceLicenseRegistry(this.store);
    for (const p of await this.store.listProjects()) {
      const pubs = (await this.store.getPublications(p.id)).filter((x) => x.state === "PUBLISHED");
      if (!pubs.length) continue;
      const add = (type: string, detail: string, action: string, platform: string | null = null) => flags.push({ at: nowIso(now), type, projectId: p.id, platform, detail, action, canAutoFix: !!platform && !!this.opts.editCapable?.(platform) });
      // rights
      const m = await this.store.getRights(p.id);
      for (const a of [...(m?.assets ?? []), ...(m?.music ?? [])]) {
        const rec = await reg.get(a.hash ?? `${p.id}/${a.assetId}`);
        if (a.status === "REVOKED" || rec?.status === "REVOKED") add("RIGHTS_REVOKED", `asset ${a.assetId} bị thu hồi quyền`, "Xem xét gỡ/thay asset trên bài đã đăng");
        else if (a.expiresAt && new Date(a.expiresAt) <= now) add("RIGHTS_EXPIRED", `asset ${a.assetId} hết hạn ${a.expiresAt}`, "Gỡ hoặc gia hạn giấy phép");
      }
      // facts & prices
      for (const c of await this.store.getClaims(p.id)) {
        if (c.status === "CONTRADICTED") add("CLAIM_DISPUTED", `claim ${c.id} có nguồn mâu thuẫn`, "Ghim/bổ sung đính chính hoặc gỡ");
        else if (c.checkedAt && now.getTime() - new Date(c.checkedAt).getTime() > (c.ttlHours ?? CLAIM_TTL_HOURS[c.topic]) * 3600_000 && ["news", "price", "spec", "game_feature"].includes(c.topic))
          add("FACT_STALE", `claim ${c.id} (${c.topic}) quá hạn kiểm chứng`, "Kiểm chứng lại; sửa mô tả nếu đã sai");
      }
      if (p.productId) {
        const prod = await this.store.getProduct(p.productId);
        if (prod?.affiliateLink?.expiresAt && new Date(prod.affiliateLink.expiresAt) <= now) add("AFFILIATE_LINK_EXPIRED", "link affiliate trong bài đã hết hạn", "Tạo link mới; sửa mô tả nếu nền tảng cho phép", pubs[0].platform);
        if (prod?.price?.verifiedAt && now.getTime() - new Date(prod.price.verifiedAt).getTime() > 24 * 3600_000) add("PRICE_STALE", "giá nêu trong bài có thể đã đổi", "Bỏ giá cụ thể khỏi mô tả/ghim bình luận đính chính");
      }
      // CTA links (own links only, light HEAD)
      const meta = await readJson(this.store.p("projects", p.id, "metadata.json"), z.record(z.any())).catch(() => null);
      const urls = [...new Set(JSON.stringify(meta ?? {}).match(/https:\/\/[^\s"\\]+/g) ?? [])].slice(0, 5);
      for (const u of urls) {
        if (!this.opts.fetchImpl) break;
        const r = await this.opts.fetchImpl(u, { method: "HEAD", redirect: "manual" }).catch(() => null);
        if (r && r.status >= 400) add("CTA_LINK_BROKEN", `${u} trả HTTP ${r.status}`, "Cập nhật link CTA", pubs[0].platform);
      }
      // game truth drift
      if (p.gameId && deps.gameFeatures) {
        const text = JSON.stringify(meta ?? {}).toLowerCase();
        for (const f of await deps.gameFeatures(p.gameId))
          if (f.status === "deprecated" && [f.name, ...f.keywords].some((k) => k.length > 3 && text.includes(k.toLowerCase()))) add("GAME_FEATURE_REMOVED", `bài nhắc "${f.name}" nhưng tính năng đã bị loại bỏ`, "Thêm đính chính/cập nhật mô tả");
      }
      if (p.gameId && deps.latestBuild) {
        const latest = await deps.latestBuild(p.gameId);
        const plan = await readJson(this.store.p("games", p.gameId, "projects", p.id, "input.json"), z.object({ buildId: z.string().nullable() }).passthrough()).catch(() => null);
        if (latest && plan?.buildId && plan.buildId !== latest) add("GAME_BUILD_OUTDATED", `video dùng build ${plan.buildId}, hiện đã có ${latest}`, "Cân nhắc devlog cập nhật; không sửa nội dung cũ thành 'mới nhất'");
      }
    }
    for (const pid of [...new Set(flags.map((f) => f.projectId))]) {
      const lf = this.store.p("projects", pid, "lifecycle.json");
      const cur = ((await readJson(lf, z.object({ flags: z.array(z.any()) }).passthrough())) ?? { flags: [] }) as { flags: LifecycleFlag[] };
      const keys = new Set(cur.flags.map((f) => `${f.type}:${f.detail}`));
      cur.flags.push(...flags.filter((f) => f.projectId === pid && !keys.has(`${f.type}:${f.detail}`)));
      await writeJsonAtomic(lf, cur);
    }
    return flags;
  }
}
