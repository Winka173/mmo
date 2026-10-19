import * as fs from "node:fs/promises";
import { FactoryError, type MediaRights } from "@ttm/core";
import { sha256File } from "@ttm/storage";
import type { DiscoveredItem } from "./connectors.js";

export type AcquisitionDecision =
  | { action: "LOCAL_IMPORT"; reason: string }
  | { action: "OFFICIAL_DOWNLOAD"; reason: string }
  | { action: "IDEA_ONLY"; next: "ORIGINAL_REMAKE"; reason: string }
  | { action: "RIGHTS_REVIEW"; reason: string };

/**
 * Media acquisition decision tree (spec O3). "Downloadable" never implies "publishable":
 * only owned media or media whose licence explicitly grants commercial + derivative use is taken.
 * There is deliberately no code path for stream ripping, DRM, watermark removal or screen capture.
 */
export function decideAcquisition(item: DiscoveredItem, rights: Pick<MediaRights, "commercialUse" | "adaptationAllowed" | "redistributionAllowed" | "licenseId"> | null): AcquisitionDecision {
  if (item.downloadPermission === "owned") return { action: "LOCAL_IMPORT", reason: "media thuộc sở hữu của bạn" };
  if (item.downloadPermission === "allowed_by_license") {
    if (!rights?.licenseId) return { action: "RIGHTS_REVIEW", reason: "nguồn nói được phép nhưng chưa ghi license ID/bằng chứng" };
    if (rights.commercialUse && rights.adaptationAllowed) return { action: "OFFICIAL_DOWNLOAD", reason: `license ${rights.licenseId} cho phép thương mại + phái sinh` };
    return { action: "IDEA_ONLY", next: "ORIGINAL_REMAKE", reason: `license ${rights.licenseId} không cho phép thương mại hoặc phái sinh` };
  }
  return { action: "IDEA_ONLY", next: "ORIGINAL_REMAKE", reason: "không có quyền tải/phân phối lại — chỉ dùng ý tưởng, tự dựng nội dung gốc" };
}

/**
 * Download only after `decideAcquisition` returned OFFICIAL_DOWNLOAD. Bounded retries, HTTP Range
 * resume when the server supports it, checksum verification when an expected hash is known.
 */
export async function lawfulDownload(
  url: string,
  dest: string,
  opts: { decision: AcquisitionDecision; expectedSha256?: string; fetchImpl?: typeof fetch; maxAttempts?: number; allowedMime?: RegExp },
): Promise<{ file: string; sha256: string; bytes: number }> {
  if (opts.decision.action !== "OFFICIAL_DOWNLOAD") throw new FactoryError("DOWNLOAD_NOT_PERMITTED", "BLOCKED", `Không tải: ${opts.decision.reason}`, { manualFallback: "ORIGINAL_REMAKE" });
  const f = opts.fetchImpl ?? fetch;
  const part = `${dest}.part`;
  for (let attempt = 1; attempt <= (opts.maxAttempts ?? 4); attempt++) {
    const have = (await fs.stat(part).catch(() => null))?.size ?? 0;
    const res = await f(url, { headers: have ? { range: `bytes=${have}-` } : {} }).catch((e) => ({ status: 0, ok: false, error: e }) as any);
    if (res.status === 0) {
      if (attempt === (opts.maxAttempts ?? 4)) throw new FactoryError("NETWORK", "RETRYABLE", `Mạng lỗi khi tải: ${res.error?.message}`);
      continue;
    }
    if ([403, 404, 410].includes(res.status))
      throw new FactoryError(`HTTP_${res.status}`, res.status === 403 ? "HUMAN_REQUIRED" : "PERMANENT", `Không tải được (${res.status}) — URL hết hạn/không còn quyền; lấy lại qua nút tải chính thức hoặc dùng asset thay thế`, {
        manualFallback: "USER_EXPORT",
      });
    if (res.status === 416) {
      await fs.rm(part, { force: true }); // invalid range: restart from zero
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt === (opts.maxAttempts ?? 4)) throw new FactoryError(`HTTP_${res.status}`, "RETRYABLE", `Máy chủ nguồn bận (${res.status})`);
      const ra = Number(res.headers?.get?.("retry-after") ?? 0);
      await new Promise((r) => setTimeout(r, Math.min(ra * 1000 || 500 * 2 ** attempt, 60_000)));
      continue;
    }
    if (!res.ok) throw new FactoryError(`HTTP_${res.status}`, "PERMANENT", `Tải thất bại HTTP ${res.status}`);
    const mime = res.headers.get("content-type") ?? "";
    if (opts.allowedMime && !opts.allowedMime.test(mime)) throw new FactoryError("UNSUPPORTED_MIME", "PERMANENT", `Định dạng không hỗ trợ: ${mime}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.status === 206 && have) await fs.appendFile(part, buf);
    else await fs.writeFile(part, buf);
    const expectedLen = Number(res.headers.get("content-length") ?? 0);
    if (expectedLen && buf.length < expectedLen) continue; // truncated: resume next attempt
    const sha = await sha256File(part);
    if (opts.expectedSha256 && sha !== opts.expectedSha256) {
      await fs.rm(part, { force: true });
      throw new FactoryError("CHECKSUM_MISMATCH", "RETRYABLE", "Checksum không khớp — file tải về bị hỏng/không đúng");
    }
    await fs.rename(part, dest);
    return { file: dest, sha256: sha, bytes: (await fs.stat(dest)).size };
  }
  throw new FactoryError("DOWNLOAD_EXHAUSTED", "RETRYABLE", "Hết số lần thử tải");
}
