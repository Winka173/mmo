import * as fs from "node:fs/promises";
import { DATA_VERSION } from "@ttm/core";
import { describe, expect, it } from "vitest";
import { DataStore, SecretStore, createBackup, planRestore, readDataVersion, restoreBackup, runMigrations, verifyDataDir, writeJsonAtomic } from "../src/index.js";
import { tmpDir } from "./helpers.js";

/** Build a V3 (dataVersion 1) data dir like the one Phase 1 produced. */
async function v1Store() {
  const root = await tmpDir();
  const store = new DataStore(root);
  await fs.mkdir(store.p("config"), { recursive: true });
  await writeJsonAtomic(store.p("config", "schema-version.json"), { schemaVersion: 1, createdAt: "2026-10-01T00:00:00.000Z" });
  await writeJsonAtomic(store.p("config", "settings.json"), { schemaVersion: 1, killSwitch: false });
  await fs.mkdir(store.p("game", "machine-brigade", "fixture-project"), { recursive: true });
  await fs.writeFile(store.p("game", "machine-brigade", "fixture-project", "game-manifest.json"), '{"game":"Machine Brigade"}');
  await writeJsonAtomic(store.p("projects", "old-devlog", "project.json"), {
    schemaVersion: 1, id: "old-devlog", brand: "machine-brigade", contentType: "GAME_DEVLOG", title: "Devlog cũ", mode: "demo", status: "READY_FOR_REVIEW",
    revision: 1, topicId: null, productId: null, formats: ["short_9x16"], categories: [], originalityChecklist: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
  });
  return store;
}

describe("V4 data migration (v1 -> v2)", () => {
  it("dry-run reports changes without writing", async () => {
    const store = await v1Store();
    const r = await runMigrations(store, { dryRun: true });
    expect(r).toMatchObject({ from: 1, to: 2, dryRun: true });
    expect(r.steps[0].changes.join("\n")).toMatch(/games\/machine-brigade\/legacy/);
    expect(await readDataVersion(store)).toBe(1);
    await expect(fs.access(store.p("games"))).rejects.toThrow();
  });

  it("init() migrates forward with a pre-migration backup; old files and IDs preserved; machine-brigade alias -> gameId", async () => {
    const store = await v1Store();
    await store.init();
    expect(store.lastMigration?.from).toBe(1);
    expect(await readDataVersion(store)).toBe(DATA_VERSION);
    expect(store.lastMigration?.backup).toBeTruthy();
    expect(await fs.readFile(store.p("game", "machine-brigade", "fixture-project", "game-manifest.json"), "utf8")).toContain("Machine Brigade"); // original kept
    expect(await fs.readFile(store.p("games", "machine-brigade", "legacy", "fixture-project", "game-manifest.json"), "utf8")).toContain("Machine Brigade");
    const p = await store.getProject("old-devlog");
    expect(p).toMatchObject({ id: "old-devlog", gameId: "machine-brigade", language: "vi" });
    // idempotent: second init does nothing
    const again = new DataStore(store.root);
    await again.init();
    expect(again.lastMigration).toBeNull();
  });

  it("refuses data newer than the code (no silent downgrade)", async () => {
    const store = new DataStore(await tmpDir());
    await store.init();
    await writeJsonAtomic(store.p("config", "schema-version.json"), { schemaVersion: 1, dataVersion: DATA_VERSION + 1 });
    await expect(new DataStore(store.root).init()).rejects.toThrow(/mới hơn mã nguồn/);
  });
});

describe("backup / restore (AB1)", () => {
  it("backup has checksums; restore --dry-run writes nothing; restore into temp dir works", async () => {
    const store = new DataStore(await tmpDir());
    await store.init();
    await store.updateSettings((s) => ({ ...s, paused: true }), "test");
    const b = await createBackup(store, { label: "t" });
    await store.updateSettings((s) => ({ ...s, paused: false, killSwitch: true }), "test");
    const name = b.dir.split(/[\\/]/).pop()!;
    const dry = await restoreBackup(store, name, { dryRun: true });
    expect(dry.restored).toBe(0);
    expect(dry.plan.compatible).toBe(true);
    expect(dry.plan.willOverwrite).toBeGreaterThan(0);
    expect((await store.getSettings()).killSwitch).toBe(true);
    const real = await restoreBackup(store, name);
    expect(real.restored).toBeGreaterThan(0);
    expect((await store.getSettings())).toMatchObject({ paused: true, killSwitch: false });
  });

  it("detects a tampered backup file and refuses to restore it", async () => {
    const store = new DataStore(await tmpDir());
    await store.init();
    const b = await createBackup(store);
    await fs.writeFile(`${b.dir}/config/settings.json`, '{"schemaVersion":1,"killSwitch":true}');
    const name = b.dir.split(/[\\/]/).pop()!;
    const plan = await planRestore(store, name);
    expect(plan.compatible).toBe(false);
    expect(plan.integrity.corrupt).toContain("config/settings.json");
    await expect(restoreBackup(store, name)).rejects.toThrow(/checksum/);
  });

  it("restores an older-schema backup and migrates it with validation", async () => {
    const store = await v1Store();
    // take a v1 backup by hand-copying (pre-V4 backups had no manifest checksums)
    await fs.mkdir(store.p("backups", "legacy-v1", "projects", "old-devlog"), { recursive: true });
    await fs.mkdir(store.p("backups", "legacy-v1", "config"), { recursive: true });
    await fs.copyFile(store.p("projects", "old-devlog", "project.json"), store.p("backups", "legacy-v1", "projects", "old-devlog", "project.json"));
    await fs.copyFile(store.p("config", "schema-version.json"), store.p("backups", "legacy-v1", "config", "schema-version.json"));
    await fs.writeFile(store.p("backups", "legacy-v1", "BACKUP.json"), JSON.stringify({ createdAt: "2026-10-01", files: 2, includeMedia: false }));
    await store.init(); // now v2
    const r = await restoreBackup(store, "legacy-v1");
    expect(r.plan.dataVersion).toBe(1);
    expect(r.migration?.to).toBe(DATA_VERSION);
    expect(await readDataVersion(store)).toBe(DATA_VERSION);
    expect((await store.getProject("old-devlog"))?.gameId).toBe("machine-brigade");
  });

  it("secrets only leave the machine encrypted with a passphrase; wrong passphrase fails", async () => {
    const store = new DataStore(await tmpDir());
    await store.init();
    const secrets = new SecretStore(store);
    await secrets.set("telegram.botToken", "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh");
    const b = await createBackup(store, { secretsPassphrase: "đúng-mật-khẩu" });
    const raw = await fs.readFile(`${b.dir}/secrets.enc`, "utf8");
    expect(raw).not.toContain("ABCDEFGHIJ");
    await fs.rm(store.p("secrets", "telegram.botToken.secret"));
    const name = b.dir.split(/[\\/]/).pop()!;
    await expect(restoreBackup(store, name, { secretsPassphrase: "sai" })).rejects.toThrow();
    await restoreBackup(store, name, { secretsPassphrase: "đúng-mật-khẩu" });
    expect(await secrets.get("telegram.botToken")).toBe("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh");
  });
});

describe("factory verify", () => {
  it("flags corrupt JSON, schema violations, misplaced jobs, truncated JSONL, stale temp files and media hash drift", async () => {
    const store = new DataStore(await tmpDir());
    await store.init();
    await fs.mkdir(store.p("projects", "p1"), { recursive: true });
    await fs.writeFile(store.p("projects", "p1", "project.json"), '{"schemaVersion":1,"id":"p1"'); // half-written
    await writeJsonAtomic(store.p("products", "x", "product.json"), { schemaVersion: 1, id: "x" }); // schema violation
    await writeJsonAtomic(store.p("jobs", "queued", "job_1.json"), { state: "running" });
    await fs.appendFile(store.p("audit", "2026-10-20.jsonl"), '{"a":1}\n{"trunc');
    const tmp = store.p("config", ".settings.json.1.abcd.tmp");
    await fs.writeFile(tmp, "x");
    const old = new Date(Date.now() - 3600_000);
    await fs.utimes(tmp, old, old);
    await fs.mkdir(store.p("games", "g1", "media"), { recursive: true });
    await fs.writeFile(store.p("games", "g1", "media", "a.bin"), "hello");
    await writeJsonAtomic(store.p("games", "g1", "media", "index.json"), { assets: [{ path: "games/g1/media/a.bin", sha256: "0".repeat(64) }] });
    const r = await verifyDataDir(store, { fix: true });
    const probs = r.issues.map((i) => `${i.file}: ${i.problem}`).join("\n");
    expect(r.ok).toBe(false);
    expect(probs).toMatch(/projects\/p1\/project\.json: JSON hỏng/);
    expect(probs).toMatch(/products\/x\/product\.json: sai schema/);
    expect(probs).toMatch(/state=running nhưng nằm trong thư mục queued/);
    expect(probs).toMatch(/dòng JSONL hỏng/);
    expect(probs).toMatch(/sai SHA256/);
    expect(r.issues.find((i) => i.problem.includes("file tạm"))?.fixed).toBe(true);
    await expect(fs.access(tmp)).rejects.toThrow();
  });
});
