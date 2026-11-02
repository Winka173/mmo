import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DataStore } from "@ttm/storage";
import { StudioStore } from "../src/studio.js";

const context = vi.hoisted(() => ({ store: null as DataStore | null, accesses: 0 }));
vi.mock("../../../apps/web/app/lib/data", () => ({ getStore: async () => { context.accesses++; return context.store!; } }));
import { GET, POST } from "../../../apps/web/app/api/studio/projects/route";

const endpoint = "http://localhost:3077/api/studio/projects";
const request = (value: unknown, headers: Record<string, string> = {}) => new Request(endpoint, {
  method: "POST", headers: { host: "localhost:3077", origin: "http://localhost:3077", "content-type": "application/json", ...headers }, body: JSON.stringify(value),
});

describe("Projects API uses durable profiles with origin and revision gates", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "acs-projects-api-test-"));
    context.store = new DataStore(root); await context.store.init(); context.accesses = 0;
  });
  afterEach(async () => {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("acs-projects-api-test-")) throw new Error("Unsafe test cleanup path");
    await fs.rm(resolved, { recursive: true, force: true });
  });

  it("rejects missing, remote and mismatched origins before accessing storage", async () => {
    const rejectedHeaders: Record<string, string>[] = [{ origin: "" }, { origin: "null" }, { origin: "http://evil.example" }, { host: "evil.example" }, { origin: "http://localhost:3078" }];
    for (const headers of rejectedHeaders) {
      const response = await POST(request({ action: "save", value: { name: "Blocked" } }, headers));
      expect(response.status).toBe(403);
    }
    const noOrigin = new Request(endpoint, { method: "POST", headers: { host: "localhost:3077" }, body: "{}" });
    expect((await POST(noOrigin)).status).toBe(403);
    expect(context.accesses).toBe(0);
  });

  it("creates, lists, edits and retrieves real revision history", async () => {
    const response = await POST(request({ action: "save", value: { name: "Chủ đề mới", kind: "topic", defaults: { languages: ["vi-VN", "en-US"] } } }));
    expect(response.status).toBe(200); const first = await response.json();
    const list = await (await GET(new Request(endpoint))).json(); expect(list.projects).toEqual([first]);
    const update = await POST(request({ action: "save", value: { id: first.id, revision: 1, name: "Tên mới", kind: "topic", defaults: first.defaults } }));
    expect(update.status).toBe(200); const second = await update.json();
    const detail = await (await GET(new Request(`${endpoint}?id=${first.id}`))).json();
    expect(detail.project).toEqual(second); expect(detail.history).toEqual([first, second]);
    const stale = await POST(request({ action: "save", value: { id: first.id, revision: 1, name: "Stale" } }));
    expect(stale.status).toBe(409); expect((await stale.json()).code).toBe("conflict");
  });

  it("creates a persisted rights-pending disabled Autopilot using exact project revision", async () => {
    const first = await (await POST(request({ action: "save", value: { name: "Partner", kind: "partner", defaults: { audience: "Vietnamese viewers", brief: "Source context" } } }))).json();
    const response = await POST(request({ action: "create-autopilot", projectId: first.id, revision: first.revision }));
    expect(response.status).toBe(200); const draft = await response.json();
    expect(draft.project).toEqual({ id: first.id, revision: 1 }); expect(draft.brief).toBe("Source context"); expect(draft.audience).toBe("Vietnamese viewers");
    expect(draft.enabled).toBe(false); expect(draft.policyConsent).toBe(false); expect(draft.rights).toBe("PERMISSION_PENDING"); expect(draft.mode).toBe("DRAFT_ONLY");
    expect(await new StudioStore(context.store!).autopilot(draft.id)).toEqual(draft);
  });

  it("rejects malformed input, forged publishing permission and traversal", async () => {
    for (const body of [
      { action: "save", value: { name: "", kind: "brand" } },
      { action: "save", value: { name: "Invalid", defaults: { languages: [] } } },
      { action: "save", value: { name: "Invalid", defaults: { rights: "AUTHORIZED_REUSE" } } },
      { action: "save", value: { name: "Invalid", policyConsent: true } },
      { action: "create-autopilot", projectId: "../outside", revision: 1 },
      { action: "create-autopilot", projectId: "5102d775-5fdd-4a2a-9b63-e82a2575f860", revision: 1, enabled: true },
      { action: "unknown" },
    ]) expect((await POST(request(body))).status).toBe(400);
    expect((await GET(new Request(`${endpoint}?id=..%2Foutside`))).status).toBe(400);
    const malformed = new Request(endpoint, { method: "POST", headers: { host: "localhost:3077", origin: "http://localhost:3077" }, body: "{" });
    expect((await POST(malformed)).status).toBe(400);
    const missing = await POST(request({ action: "create-autopilot", projectId: "5102d775-5fdd-4a2a-9b63-e82a2575f860", revision: 1 }));
    expect(missing.status).toBe(404);
    expect(await new StudioStore(context.store!).autopilots()).toEqual([]);
  });
});
