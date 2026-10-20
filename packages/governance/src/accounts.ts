import { FactoryError, Platform, nowIso, type Project } from "@ttm/core";
import { DataStore, readJson, writeJsonAtomic } from "@ttm/storage";
import { z } from "zod";

export const AccountOwner = z.object({ kind: z.enum(["brand", "game"]), id: z.string().min(2) });
export type AccountOwner = z.infer<typeof AccountOwner>;

export const Account = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{2,60}$/),
  platform: Platform,
  owner: AccountOwner,
  displayName: z.string().min(1),
  /** Remote channel/page/user id the connected credential MUST resolve to (wrong-identity guard). */
  expectedRemoteId: z.string().nullable().default(null),
  /** Secret-store prefix: credentials live in `acct.<id>.*` — isolated per account. */
  credentialRef: z.string().default(""),
  enabled: z.boolean().default(true),
  /** Owner explicitly confirmed this destination (prepublish confirmation on new account). */
  confirmedAt: z.string().nullable().default(null),
  confirmedBy: z.string().nullable().default(null),
  addedAt: z.string(),
  notes: z.string().default(""),
});
export type Account = z.infer<typeof Account>;

export const AccountsFile = z.object({ schemaVersion: z.literal(1).default(1), accounts: z.array(Account).default([]) });

export function ownerOfProject(p: Pick<Project, "brand" | "gameId">): AccountOwner {
  return p.gameId ? { kind: "game", id: p.gameId } : { kind: "brand", id: p.brand };
}

const sameOwner = (a: AccountOwner, b: AccountOwner) => a.kind === b.kind && a.id === b.id;

export type DestinationCheck =
  | { ok: true; account: Account }
  | { ok: false; code: "NO_DESTINATION" | "WRONG_ACCOUNT" | "NOT_ALLOWLISTED" | "DESTINATION_CONFIRM_REQUIRED" | "ACCOUNT_DISABLED"; reason: string };

/**
 * MultiAccountManager: strong mapping brand/game -> allowed accounts. Posting is only possible to
 * an account owned by the same brand/game, present in the game's destinationAllowlist, confirmed by
 * the owner, and whose live credential resolves to the expected remote identity.
 */
export class MultiAccountManager {
  constructor(private readonly store: DataStore) {}
  private file() {
    return this.store.p("config", "accounts.json");
  }
  async list(): Promise<Account[]> {
    return (await readJson(this.file(), AccountsFile))?.accounts ?? [];
  }
  async get(id: string) {
    return (await this.list()).find((a) => a.id === id) ?? null;
  }
  async upsert(input: z.input<typeof Account>, actor: string): Promise<Account> {
    const acc = Account.parse({ credentialRef: `acct.${input.id}`, ...input });
    const all = await this.list();
    const i = all.findIndex((a) => a.id === acc.id);
    if (i >= 0) {
      const prev = all[i];
      // changing owner/platform/remote id invalidates any previous confirmation
      if (!sameOwner(prev.owner, acc.owner) || prev.platform !== acc.platform || prev.expectedRemoteId !== acc.expectedRemoteId) {
        acc.confirmedAt = null;
        acc.confirmedBy = null;
      }
      all[i] = acc;
    } else all.push({ ...acc, confirmedAt: null, confirmedBy: null });
    await writeJsonAtomic(this.file(), { schemaVersion: 1, accounts: all });
    await this.store.audit({ actor, action: "account.upsert", subject: acc.id, detail: { platform: acc.platform, owner: acc.owner } });
    return all.find((a) => a.id === acc.id)!;
  }
  async confirm(id: string, actor: string): Promise<Account> {
    const all = await this.list();
    const a = all.find((x) => x.id === id);
    if (!a) throw new Error(`Không có tài khoản ${id}`);
    a.confirmedAt = nowIso();
    a.confirmedBy = actor;
    await writeJsonAtomic(this.file(), { schemaVersion: 1, accounts: all });
    await this.store.audit({ actor, action: "account.confirm", subject: id });
    return a;
  }
  async disable(id: string, actor: string, reason: string) {
    const all = await this.list();
    const a = all.find((x) => x.id === id);
    if (a) {
      a.enabled = false;
      a.notes = `${a.notes}\n[${nowIso()}] tắt: ${reason}`.trim();
      await writeJsonAtomic(this.file(), { schemaVersion: 1, accounts: all });
      await this.store.audit({ actor, action: "account.disable", subject: id, detail: { reason } });
    }
  }

  /** Accounts a project may post to on `platform`, honouring the game's allowlist. */
  async candidates(project: Pick<Project, "brand" | "gameId">, platform: Platform, gameAllowlist: string[] | null): Promise<Account[]> {
    const owner = ownerOfProject(project);
    return (await this.list()).filter((a) => a.platform === platform && sameOwner(a.owner, owner) && (owner.kind === "brand" || (gameAllowlist ?? []).includes(a.id)));
  }

  /**
   * Hard pre-publish check; zero side effects on failure. `connectedRemoteId` is what the live
   * credential reports (e.g. YouTube channels.list mine=true) — null when not yet connected.
   */
  async checkDestination(input: {
    project: Pick<Project, "brand" | "gameId">;
    platform: Platform;
    accountId: string | null;
    gameAllowlist: string[] | null;
    connectedRemoteId: string | null;
    approvedAt?: string | null;
  }): Promise<DestinationCheck> {
    const owner = ownerOfProject(input.project);
    const cands = await this.candidates(input.project, input.platform, input.gameAllowlist);
    const acc = input.accountId ? await this.get(input.accountId) : cands.length === 1 ? cands[0] : null;
    if (!acc) return { ok: false, code: "NO_DESTINATION", reason: cands.length > 1 ? `có ${cands.length} tài khoản ${input.platform} cho ${owner.id} — cần chọn rõ` : `chưa có tài khoản ${input.platform} nào thuộc ${owner.kind}:${owner.id}` };
    if (!sameOwner(acc.owner, owner)) return { ok: false, code: "WRONG_ACCOUNT", reason: `tài khoản ${acc.id} thuộc ${acc.owner.kind}:${acc.owner.id}, không phải ${owner.kind}:${owner.id}` };
    if (acc.platform !== input.platform) return { ok: false, code: "WRONG_ACCOUNT", reason: `tài khoản ${acc.id} là ${acc.platform}, không phải ${input.platform}` };
    if (owner.kind === "game" && !(input.gameAllowlist ?? []).includes(acc.id)) return { ok: false, code: "NOT_ALLOWLISTED", reason: `tài khoản ${acc.id} không nằm trong destinationAllowlist của game ${owner.id}` };
    if (!acc.enabled) return { ok: false, code: "ACCOUNT_DISABLED", reason: `tài khoản ${acc.id} đang tắt` };
    if (!acc.confirmedAt) return { ok: false, code: "DESTINATION_CONFIRM_REQUIRED", reason: `tài khoản ${acc.id} chưa được chủ kênh xác nhận làm điểm đăng` };
    if (input.approvedAt && acc.confirmedAt > input.approvedAt && acc.addedAt > input.approvedAt)
      return { ok: false, code: "DESTINATION_CONFIRM_REQUIRED", reason: `tài khoản ${acc.id} được thêm sau khi duyệt — cần duyệt lại điểm đăng` };
    if (acc.expectedRemoteId && input.connectedRemoteId && acc.expectedRemoteId !== input.connectedRemoteId)
      return { ok: false, code: "WRONG_ACCOUNT", reason: `SAI TÀI KHOẢN: credential đang kết nối ${input.connectedRemoteId}, cần ${acc.expectedRemoteId}` };
    return { ok: true, account: acc };
  }
}

export function assertDestination(c: DestinationCheck): Account {
  if (c.ok) return c.account;
  throw new FactoryError(c.code, c.code === "WRONG_ACCOUNT" ? "HUMAN_REQUIRED" : "BLOCKED", c.reason, { nextAction: "Mở Cài đặt → Tài khoản để chọn/xác nhận đúng điểm đăng" });
}
