import { MockPublisher } from "@ttm/platforms";
import { GameRegistry, approveGameVideo, seedGameFixtures } from "@ttm/games";
import { MultiAccountManager } from "@ttm/governance";
import { beforeAll, describe, expect, it } from "vitest";
import { buildContext, type Ctx } from "../src/context.js";
import { processUntilIdle } from "../src/handlers.js";
import { tmpDir } from "../../../packages/storage/test/helpers.js";

let ctx: Ctx;
let yt: MockPublisher;
let games: GameRegistry;

/** Runs the queued PUBLISH job for the LH teaser and returns its final job state. */
async function runPublish(): Promise<{ state: string; code: string | null }> {
  const jobs = [...(await ctx.queue.list("queued")), ...(await ctx.queue.list("needs_review")), ...(await ctx.queue.list("manual_action"))].filter((j) => j.kind === "PUBLISH" && j.payload.projectId === "game-lh-teaser" && j.payload.platform === "youtube_shorts");
  const j = jobs[0];
  if (j.state !== "queued") await ctx.queue.transition(j.id, "queued", "test requeue", (x) => ({ ...x, notBefore: null, attempts: 0 }));
  await processUntilIdle(ctx, { maxJobs: 5 });
  const after = (await ctx.queue.get(j.id))!;
  return { state: after.state, code: after.lastError?.errorCode ?? null };
}

beforeAll(async () => {
  ctx = await buildContext({ dataDir: await tmpDir("ttm-gpub-"), log: (m) => process.env.DEBUG_GP && console.log(m) });
  await ctx.store.updateSettings((s) => ({ ...s, externalPostingEnabled: true, dailyCaps: { ...s.dailyCaps, shorts: 5 } }), "test");
  yt = new MockPublisher("youtube_shorts", "UC_LANTERN");
  ctx.publishers = { youtube_shorts: yt };
  await seedGameFixtures(ctx.store);
  games = new GameRegistry(ctx.store);
  const input = (await games.getVideo("lantern-hollow", "game-lh-teaser"))!;
  await games.saveVideo({ ...input, formats: ["short_9x16"], targets: ["youtube_shorts"], clips: [{ ...input.clips[0], out: 6 }] }, "test");
  const { job } = await ctx.queue.enqueue({ kind: "GAME_PRODUCE", idempotencyKey: "gp:lh", payload: { gameId: "lantern-hollow", projectId: "game-lh-teaser", mode: "live" }, usesGpu: true });
  await processUntilIdle(ctx, { maxJobs: 1 });
  const done = await ctx.queue.get(job.id);
  if (done?.state !== "succeeded") throw new Error(`GAME_PRODUCE không thành công: ${done?.state} ${done?.lastError?.errorCode} ${done?.lastError?.message}`);
}, 600_000);

describe("game publishing safety (Y1 / Z4 / AC)", () => {
  it("GAME_PRODUCE renders and queues a gameId-scoped PUBLISH job", async () => {
    const pubs = (await ctx.queue.list("queued")).filter((j) => j.kind === "PUBLISH");
    expect(pubs).toHaveLength(1);
    expect(pubs[0].idempotencyKey).toMatch(/^lantern-hollow:game-lh-teaser:r\d+:youtube_shorts$/);
  });

  it("not approved -> held for review, zero uploads", async () => {
    expect(await runPublish()).toMatchObject({ state: "needs_review", code: "GAME_APPROVAL_REQUIRED" });
    expect(yt.uploads).toBe(0);
  });

  it("approved but destination not confirmed -> blocked, zero uploads", async () => {
    await approveGameVideo(ctx.store, "lantern-hollow", "game-lh-teaser", "editor");
    expect(await runPublish()).toMatchObject({ state: "needs_review", code: "DESTINATION_CONFIRM_REQUIRED" });
    expect(yt.uploads).toBe(0);
  });

  it("credential connected to the WRONG channel (account swap) -> halt, zero uploads", async () => {
    const mam = new MultiAccountManager(ctx.store);
    const acc = (await mam.get("yt-lantern-hollow"))!;
    await mam.upsert({ ...acc, expectedRemoteId: "UC_LANTERN_REAL" }, "owner");
    await mam.confirm("yt-lantern-hollow", "owner");
    expect(await runPublish()).toMatchObject({ state: "manual_action", code: "WRONG_ACCOUNT" });
    expect(yt.uploads).toBe(0);
  });

  it("game B project can never be routed to game A's account", async () => {
    const input = (await games.getVideo("lantern-hollow", "game-lh-teaser"))!;
    await games.saveVideo({ ...input, accounts: { youtube_shorts: "yt-machine-brigade" } }, "attacker");
    await approveGameVideo(ctx.store, "lantern-hollow", "game-lh-teaser", "editor");
    const r = await runPublish();
    expect(r.state).not.toBe("succeeded");
    expect(["NOT_ALLOWLISTED", "WRONG_ACCOUNT"]).toContain(r.code);
    expect(yt.uploads).toBe(0);
    await games.undoVideo("lantern-hollow", "game-lh-teaser", "owner");
  });

  it("thumbnail changed after approval -> approval invalid, zero uploads; re-approve + right account -> published once", async () => {
    const mam = new MultiAccountManager(ctx.store);
    const acc = (await mam.get("yt-lantern-hollow"))!;
    await mam.upsert({ ...acc, expectedRemoteId: "UC_LANTERN" }, "owner");
    await mam.confirm("yt-lantern-hollow", "owner");
    await approveGameVideo(ctx.store, "lantern-hollow", "game-lh-teaser", "editor");
    const input = (await games.getVideo("lantern-hollow", "game-lh-teaser"))!;
    const shot = (await games.media("lantern-hollow")).find((a) => a.kind === "screenshot")!;
    await games.saveVideo({ ...input, thumbnail: { ...input.thumbnail, user9x16: shot.assetId } }, "user");
    expect(await runPublish()).toMatchObject({ state: "needs_review", code: "GAME_APPROVAL_REQUIRED" });
    expect(yt.uploads).toBe(0);
    await approveGameVideo(ctx.store, "lantern-hollow", "game-lh-teaser", "editor");
    expect((await runPublish()).state).toBe("succeeded");
    expect(yt.uploads).toBe(1);
    const pub = (await ctx.store.getPublications("game-lh-teaser"))[0];
    expect(pub).toMatchObject({ state: "PUBLISHED", accountId: "yt-lantern-hollow" });
  });

  it("embargo in the future blocks even an approved post", async () => {
    const g = (await games.get("lantern-hollow"))!;
    await games.save({ ...g, embargoUntil: "2099-01-01T00:00:00Z" }, "owner");
    const input = (await games.getVideo("lantern-hollow", "game-lh-teaser"))!;
    const key = await ctx.queue.enqueue({ kind: "PUBLISH", idempotencyKey: "lantern-hollow:game-lh-teaser:embargo-test:youtube_shorts", payload: { projectId: "game-lh-teaser", platform: "youtube_shorts", format: "short_9x16", gameId: "lantern-hollow" } });
    await processUntilIdle(ctx, { maxJobs: 2 });
    expect((await ctx.queue.get(key.job.id))?.lastError?.errorCode).toBe("EMBARGO");
    expect(yt.uploads).toBe(1);
    expect(input).toBeTruthy();
  });
});
