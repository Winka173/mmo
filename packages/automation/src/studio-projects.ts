import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { z } from "zod";
import { DataStore, readJson, withLock, writeJsonAtomic } from "@ttm/storage";
import { Pronunciation } from "./pronunciation.js";
import { Autopilot, StudioStore } from "./studio.js";

const Language = z.enum(["vi-VN", "en-US", "en-GB"]);
export const ProjectKind = z.enum(["game", "brand", "topic", "partner", "custom"]);
export const ProjectBinding = z.object({ id: z.string().uuid(), revision: z.number().int().positive() }).strict();
export const ProjectDefaults = z.object({
  languages: z.array(Language).min(1).max(3).refine(v => new Set(v).size === v.length, "Duplicate language").default(["vi-VN"]),
  audience: z.string().trim().max(2000).default(""),
  tone: z.string().trim().max(1000).default("clear"),
  brief: z.string().trim().max(30000).default(""),
  sourceFolder: z.string().trim().max(4096).default(""),
  pronunciation: z.array(Pronunciation).max(200).refine(rows => {
    const keys = rows.map(row => `${row.language}:${row.term.toLocaleLowerCase()}`);
    return new Set(keys).size === keys.length;
  }, "Duplicate pronunciation term in the same language").default([]),
}).strict();
export const ProjectFields = z.object({
  name: z.string().trim().min(1).max(160),
  kind: ProjectKind.default("custom"),
  defaults: ProjectDefaults.default({}),
}).strict();
export const StudioProject = ProjectFields.extend({
  id: z.string().uuid(), revision: z.number().int().positive(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type StudioProject = z.infer<typeof StudioProject>;
export const SaveProject = ProjectFields.extend({
  id: z.string().uuid().optional(), revision: z.number().int().positive().optional(),
}).strict();

// One atomic envelope makes both the current revision and its history visible together.
// Updates append a fresh snapshot and never alter a previous entry.
const ProjectFile = z.object({ schemaVersion: z.literal(1), revisions: z.array(StudioProject).min(1) }).strict().superRefine((file, ctx) => {
  const first = file.revisions[0];
  for (const [index, revision] of file.revisions.entries()) {
    if (revision.id !== first.id || revision.revision !== index + 1 || revision.createdAt !== first.createdAt)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid project revision history" });
  }
});

export class StudioProjectError extends Error {
  constructor(readonly code: "not_found" | "conflict", message: string) { super(message); }
}

export class StudioProjectStore {
  constructor(readonly store: DataStore) {}

  private file(id: string) {
    z.string().uuid().parse(id);
    return this.store.p("studio", "projects", `${id}.json`);
  }

  async history(id: string): Promise<StudioProject[]> {
    const file = await readJson(this.file(id), ProjectFile);
    if (!file) return [];
    if (file.revisions[0].id !== id) throw new Error("Project ID does not match its file / Mã dự án không khớp tệp");
    return file.revisions;
  }

  async get(id: string, revision?: number): Promise<StudioProject | null> {
    if (revision !== undefined) z.number().int().positive().parse(revision);
    const history = await this.history(id);
    return revision === undefined ? history.at(-1) ?? null : history[revision - 1] ?? null;
  }

  async list(): Promise<StudioProject[]> {
    const files = await fs.readdir(this.store.p("studio", "projects")).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const rows = await Promise.all(files.filter(file => /^[\da-f-]{36}\.json$/i.test(file)).map(file => this.get(file.slice(0, -5))));
    return rows.filter((row): row is StudioProject => row !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  async save(input: unknown): Promise<StudioProject> {
    const value = SaveProject.parse(input);
    const id = value.id ?? randomUUID();
    const project = await withLock(this.store.p("locks", `studio-project-${id}.lock`), async () => {
      const history = await this.history(id), current = history.at(-1);
      if (value.id && !current) throw new StudioProjectError("not_found", "Project not found / Không tìm thấy dự án");
      if (current && value.revision !== current.revision)
        throw new StudioProjectError("conflict", "Project changed in another session. Reload before saving / Dự án đã thay đổi. Tải lại trước khi lưu");
      if (!current && value.revision !== undefined)
        throw new StudioProjectError("conflict", "A new project cannot specify a revision / Dự án mới không được có số phiên bản");
      const now = new Date().toISOString();
      const next = StudioProject.parse({ ...value, id, revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? now, updatedAt: now });
      await writeJsonAtomic(this.file(id), { schemaVersion: 1, revisions: [...history, next] });
      return next;
    }, { purpose: "Save project profile" });
    await this.store.audit({ actor: "studio-ui", action: "project.save", subject: id, detail: { revision: project.revision, kind: project.kind } });
    return project;
  }

  /** Copy only creative defaults into a NEW draft; profiles never convey authority. */
  async createAutopilot(id: string, revision: number): Promise<Autopilot> {
    const binding = ProjectBinding.parse({ id, revision });
    const project = await this.get(binding.id, binding.revision);
    if (!project) throw new StudioProjectError("not_found", "Project revision not found / Không tìm thấy phiên bản dự án");
    const family = { game: "game", brand: "product", topic: "facts", partner: "localization", custom: "custom" }[project.kind];
    const now = new Date().toISOString();
    const draft = Autopilot.parse({
      ...project.defaults, id: randomUUID(), name: project.name, family, project: binding,
      enabled: false, mode: "DRAFT_ONLY", policyConsent: false, rights: "PERMISSION_PENDING", rightsEvidence: "",
      step: 1, createdAt: now, updatedAt: now,
    });
    return new StudioStore(this.store).saveAutopilot(draft);
  }
}
