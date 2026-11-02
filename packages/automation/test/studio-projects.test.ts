import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { DataStore } from "@ttm/storage";
import { StudioProjectStore } from "../src/studio-projects.js";
import { StudioStore } from "../src/studio.js";
import { applyPronunciations } from "../src/pronunciation.js";

describe("Persisted Projects & Brands profiles", () => {
  let store: DataStore, projects: StudioProjectStore, root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "acs-projects-test-"));
    store = new DataStore(root); await store.init(); projects = new StudioProjectStore(store);
  });
  afterEach(async () => {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("acs-projects-test-")) throw new Error("Unsafe test cleanup path");
    await fs.rm(resolved, { recursive: true, force: true });
  });

  it("persists Unicode profiles across store instances with real defaults", async () => {
    expect(await projects.list()).toEqual([]);
    const project = await projects.save({ name: "  Khoa học & Trò chơi  ", kind: "topic" });
    expect(project.name).toBe("Khoa học & Trò chơi");
    expect(project.revision).toBe(1);
    expect(project.defaults.languages).toEqual(["vi-VN"]);
    expect((await new StudioProjectStore(new DataStore(root)).list())[0]).toEqual(project);
    expect(await projects.get(project.id, 99)).toBeNull();
  });

  it("atomically appends immutable revisions and retains creation time", async () => {
    const first = await projects.save({ name: "First", kind: "game", defaults: { brief: "Verified first brief" } });
    const second = await projects.save({ id: first.id, revision: first.revision, name: "Renamed", kind: "brand", defaults: { brief: "Updated brief" } });
    expect(second.revision).toBe(2); expect(second.createdAt).toBe(first.createdAt);
    expect(await projects.history(first.id)).toEqual([first, second]);
    expect(await projects.get(first.id, 1)).toEqual(first);
    const stored = JSON.parse(await fs.readFile(store.p("studio", "projects", `${first.id}.json`), "utf8"));
    expect(stored.revisions).toEqual([first, second]);
  });

  it("accepts one concurrent writer and rejects stale or revision-free updates", async () => {
    const first = await projects.save({ name: "Original" });
    const results = await Promise.allSettled(["Writer A", "Writer B"].map(name => projects.save({ id: first.id, revision: first.revision, name })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    await expect(projects.save({ id: first.id, name: "No revision" })).rejects.toMatchObject({ code: "conflict" });
    await expect(projects.save({ id: first.id, revision: 1, name: "Stale" })).rejects.toMatchObject({ code: "conflict" });
    const history = await projects.history(first.id);
    expect(history).toHaveLength(2); expect(history[0]).toEqual(first);
  });

  it("copies useful creative defaults into a NEW disabled, rights-pending draft", async () => {
    const project = await projects.save({ name: "Thương hiệu mới", kind: "brand", defaults: {
      languages: ["vi-VN", "en-US", "en-GB"], audience: "New players", tone: "Warm and precise", brief: "Facts from owned source documents",
      sourceFolder: "C:\\Owned media\\Tiếng Việt", pronunciation: [{ term: "ACS", spoken: "A C S", language: "en-US" }],
    } });
    const draft = await projects.createAutopilot(project.id, project.revision);
    expect(draft.project).toEqual({ id: project.id, revision: 1 });
    expect(draft.name).toBe(project.name); expect(draft.family).toBe("product");
    for (const key of ["languages", "audience", "tone", "brief", "sourceFolder", "pronunciation"] as const)
      expect(draft[key]).toEqual(project.defaults[key]);
    expect(draft.enabled).toBe(false); expect(draft.mode).toBe("DRAFT_ONLY"); expect(draft.policyConsent).toBe(false);
    expect(draft.rights).toBe("PERMISSION_PENDING"); expect(draft.rightsEvidence).toBe(""); expect(draft.targets).toEqual([]);
    expect(draft.reusePermissions).toEqual({ cut: false, translate: false, dub: false, redistribute: false, expiresAt: null });
    expect(applyPronunciations("ACS", "en-US", draft.pronunciation)).toBe("A C S");
    expect(await new StudioStore(store).autopilot(draft.id)).toEqual(draft);
    expect(await new StudioStore(store).runs()).toEqual([]);
  });

  it("leaves existing Autopilots unchanged and can create from a pinned old revision", async () => {
    const first = await projects.save({ name: "Original", kind: "game", defaults: { brief: "Original verified brief", languages: ["en-GB"] } });
    const originalDraft = await projects.createAutopilot(first.id, first.revision);
    const second = await projects.save({ id: first.id, revision: 1, name: "Updated", kind: "topic", defaults: { brief: "Changed brief", languages: ["vi-VN"] } });
    expect(await new StudioStore(store).autopilot(originalDraft.id)).toEqual(originalDraft);
    const pinned = await projects.createAutopilot(first.id, 1), latest = await projects.createAutopilot(second.id, 2);
    expect(pinned.id).not.toBe(originalDraft.id); expect(pinned.brief).toBe(first.defaults.brief); expect(pinned.family).toBe("game");
    expect(pinned.project?.revision).toBe(1); expect(latest.project?.revision).toBe(2); expect(latest.family).toBe("facts");
    expect(await new StudioStore(store).autopilots()).toHaveLength(3);
  });

  it.each([ ["game", "game"], ["brand", "product"], ["topic", "facts"], ["partner", "localization"], ["custom", "custom"] ])("routes a %s project to an editable %s draft", async (kind, family) => {
    const project = await projects.save({ name: "Profile", kind });
    const draft = await projects.createAutopilot(project.id, 1);
    expect(draft.family).toBe(family); expect(draft.enabled).toBe(false);
  });

  it("does not accept permission fields, duplicate languages or ambiguous pronunciations", async () => {
    for (const value of [
      { name: "Wrong", rights: "AUTHORIZED_REUSE" },
      { name: "Wrong", defaults: { policyConsent: true } },
      { name: "Wrong", defaults: { languages: [] } },
      { name: "Wrong", defaults: { languages: ["vi-VN", "vi-VN"] } },
      { name: "Wrong", defaults: { pronunciation: [{ term: "ACS", spoken: "first", language: "vi-VN" }, { term: "acs", spoken: "second", language: "vi-VN" }] } },
      { name: " ", kind: "game" },
      { name: "Wrong", kind: "hardcoded-brand" },
    ]) await expect(projects.save(value)).rejects.toThrow();
    expect(await projects.list()).toEqual([]);
  });

  it("rejects path traversal, nonexistent revisions and accidental resurrection", async () => {
    await expect(projects.get("../outside")).rejects.toThrow();
    await expect(projects.save({ id: randomUUID(), revision: 1, name: "Missing" })).rejects.toMatchObject({ code: "not_found" });
    await expect(projects.save({ revision: 3, name: "New" })).rejects.toMatchObject({ code: "conflict" });
    await expect(projects.createAutopilot(randomUUID(), 1)).rejects.toMatchObject({ code: "not_found" });
    const project = await projects.save({ name: "Present" });
    await expect(projects.createAutopilot(project.id, 2)).rejects.toMatchObject({ code: "not_found" });
    expect(await new StudioStore(store).autopilots()).toEqual([]);
  });
});
