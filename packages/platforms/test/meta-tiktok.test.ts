import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { MetaPublisher, TikTokPublisher, type PublishPackage } from "../src/index.js";
import { tmpDir } from "../../storage/test/helpers.js";

async function pkg(): Promise<PublishPackage> {
  const d = await tmpDir();
  const f = path.join(d, "v.mp4");
  await fs.writeFile(f, Buffer.alloc(2048, 1));
  return { projectId: "p1", idempotencyKey: "k1", videoFile: f, videoSha256: "x", thumbnailFile: null, title: "T", description: "D", tags: [], privacy: "private", publishAt: null, containsSyntheticMedia: true, madeForKids: false };
}

/** Minimal Graph API fake following the documented Reels flows. */
function graphFake(opts: { id: string }) {
  const calls: string[] = [];
  let polls = 0;
  const f = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    calls.push(`${init?.method ?? "GET"} ${u.hostname}${u.pathname}${u.searchParams.get("upload_phase") ? `?${u.searchParams.get("upload_phase")}` : ""}`);
    const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
    if (u.hostname === "rupload.facebook.com") return j({ success: true });
    if (u.pathname.endsWith(`/${opts.id}`) && (!init?.method || init.method === "GET")) return j({ id: opts.id, name: "Page test", username: "ig_test" });
    if (u.pathname.endsWith("/video_reels") && u.searchParams.get("upload_phase") === "start") return j({ video_id: "vid1", upload_url: "https://rupload.facebook.com/video-upload/v21.0/vid1" });
    if (u.pathname.endsWith("/video_reels")) return j({ success: true });
    if (u.pathname.endsWith("/vid1")) return j({ id: "vid1", status: { video_status: "ready" }, permalink_url: "/reel/vid1" });
    if (u.pathname.endsWith("/media") && init?.method === "POST") return j({ id: "cont1", uri: "https://rupload.facebook.com/ig-api-upload/v21.0/cont1" });
    if (u.pathname.endsWith("/cont1")) return j({ status_code: polls++ < 1 ? "IN_PROGRESS" : "FINISHED" });
    if (u.pathname.endsWith("/media_publish")) return j({ id: "media9" });
    if (u.pathname.endsWith("/media9")) return j({ id: "media9", permalink: "https://www.instagram.com/reel/abc/" });
    return j({ error: { code: 100, message: "unknown" } }, 400);
  };
  return { f, calls };
}

describe("Meta publisher (mock Graph API — NOT a live verification)", () => {
  it("Facebook Reels: start → rupload → finish → confirm; remote id persisted before bytes", async () => {
    const { f, calls } = graphFake({ id: "page1" });
    const pub = new MetaPublisher("facebook", { accessToken: "tok", pageId: "page1", expectedId: "page1", fetchImpl: f as any });
    expect((await pub.validateCapabilities()).canPublish).toBe(true);
    const persisted: unknown[] = [];
    const r = await pub.upload(await pkg(), async (s) => void persisted.push(s));
    expect(r).toMatchObject({ status: "PUBLISHED", remoteId: "vid1" });
    expect(persisted[0]).toMatchObject({ remoteId: "vid1" });
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual(["POST graph.facebook.com/v21.0/page1/video_reels?start", "POST rupload.facebook.com/video-upload/v21.0/vid1", "POST graph.facebook.com/v21.0/page1/video_reels?finish"]);
  });
  it("Instagram Reels resumable container: waits for FINISHED, publishes, returns permalink; crash after container reconciles without re-upload", async () => {
    const { f, calls } = graphFake({ id: "ig1" });
    const pub = new MetaPublisher("instagram", { accessToken: "tok", igUserId: "ig1", fetchImpl: f as any, pollIntervalMs: 1 });
    const r = await pub.upload(await pkg(), async () => undefined);
    expect(r).toMatchObject({ status: "PUBLISHED", remoteId: "media9", url: "https://www.instagram.com/reel/abc/" });
    const before = calls.filter((c) => c.includes("rupload")).length;
    const again = await pub.upload(await pkg(), async () => undefined, { sessionUri: "ig-container:cont1" });
    expect(again.status).toBe("PUBLISHED");
    expect(calls.filter((c) => c.includes("rupload")).length).toBe(before); // no second upload
  });
  it("wrong Page behind the token => wrong-account blocker; revoked token => OAUTH_REVOKED", async () => {
    const { f } = graphFake({ id: "pageX" });
    const c = await new MetaPublisher("facebook", { accessToken: "tok", pageId: "pageX", expectedId: "page1", fetchImpl: f as any }).validateCapabilities();
    expect(c.blockers[0]).toMatch(/SAI TÀI KHOẢN/);
    const revoked = async () => new Response(JSON.stringify({ error: { code: 190, message: "expired" } }), { status: 400 });
    const p = new MetaPublisher("facebook", { accessToken: "tok", pageId: "pp1", fetchImpl: revoked as any });
    await expect(p.upload(await pkg(), async () => undefined)).rejects.toMatchObject({ code: "OAUTH_REVOKED" });
  });
});

describe("TikTok publisher", () => {
  it("unaudited app => MANUAL_ACTION_REQUIRED (no web automation)", async () => {
    const c = await new TikTokPublisher({ accessToken: "t", audited: false }).validateCapabilities();
    expect(c).toMatchObject({ canPublish: false, fallback: "MANUAL_ACTION_REQUIRED" });
  });
  it("audited: init → chunk PUT → status PUBLISH_COMPLETE", async () => {
    const calls: string[] = [];
    const f = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${new URL(url).pathname}`);
      const j = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url.includes("creator_info")) return j({ data: { creator_username: "lantern", creator_nickname: "Lantern" }, error: { code: "ok" } });
      if (url.includes("video/init")) return j({ data: { publish_id: "pub1", upload_url: "https://open-upload.tiktokapis.com/upload/x" }, error: { code: "ok" } });
      if (url.includes("upload/x")) return new Response(null, { status: 201 });
      if (url.includes("status/fetch")) return j({ data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["7777"] }, error: { code: "ok" } });
      return new Response("{}", { status: 404 });
    };
    const p = new TikTokPublisher({ accessToken: "t", audited: true, fetchImpl: f as any });
    expect((await p.validateCapabilities()).canPublish).toBe(true);
    const r = await p.upload(await pkg(), async () => undefined);
    expect(r).toMatchObject({ status: "PUBLISHED", remoteId: "7777" });
    expect(calls).toContain("PUT /upload/x");
  });
});
