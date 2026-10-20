import { nowIso } from "@ttm/core";
import { writeJsonAtomic } from "@ttm/storage";
import type { z } from "zod";
import { GameRegistry } from "./registry.js";
import { CampaignBrief, type CampaignBrief as CampaignBriefT, type GameProject } from "./schemas.js";

export type CampaignIssue = { code: string; message: string };

/** Hard rules: no countdown/launch without a confirmed date; only this game's allowlisted accounts. */
export function validateCampaign(game: GameProject, b: CampaignBriefT, now = new Date()): CampaignIssue[] {
  const out: CampaignIssue[] = [];
  if (b.gameId !== game.gameId) out.push({ code: "WRONG_GAME", message: `Chiến dịch thuộc ${b.gameId}, không phải ${game.gameId}` });
  if ((b.kind === "countdown" || b.kind === "launch" || b.countdownTo) && !game.releaseDate?.confirmed)
    out.push({ code: "UNCONFIRMED_DATE", message: "Chiến dịch đếm ngược/ra mắt chỉ được tạo khi ngày phát hành đã xác nhận" });
  if (b.countdownTo && game.releaseDate?.confirmed && b.countdownTo !== game.releaseDate.date) out.push({ code: "DATE_MISMATCH", message: `countdownTo ${b.countdownTo} khác ngày phát hành đã xác nhận ${game.releaseDate.date}` });
  for (const a of b.targetAccounts) if (!game.destinationAllowlist.includes(a)) out.push({ code: "NOT_ALLOWLISTED", message: `Tài khoản ${a} không thuộc game ${game.gameId}` });
  if (["wishlist", "store_click", "install", "demo"].includes(b.objective) && !game.storeLinks.some((l) => l.confirmedByOwner))
    out.push({ code: "NO_STORE_LINK", message: `Mục tiêu ${b.objective} cần link store/wishlist chính thức đã xác nhận — tạm dùng mục tiêu follow` });
  if (b.endDate && b.startDate && b.endDate < b.startDate) out.push({ code: "BAD_RANGE", message: "Ngày kết thúc trước ngày bắt đầu" });
  if (game.embargoUntil && b.startDate && new Date(b.startDate) < new Date(game.embargoUntil)) out.push({ code: "EMBARGO", message: `Bắt đầu trước khi hết embargo ${game.embargoUntil}` });
  if (b.startDate && new Date(b.startDate).getTime() < now.getTime() - 365 * 86400_000) out.push({ code: "STALE", message: "Ngày bắt đầu quá xa trong quá khứ" });
  return out;
}

/**
 * Spread the game's weekly cadence over the campaign window at the preferred local hours, never
 * two posts of the same game on the same day (audience fatigue), Asia/Ho_Chi_Minh wall time.
 */
export function campaignSlots(game: GameProject, b: CampaignBriefT, opts: { tzOffsetHours?: number; maxSlots?: number } = {}): string[] {
  if (!b.startDate) return [];
  const tz = opts.tzOffsetHours ?? 7;
  const start = new Date(`${b.startDate.slice(0, 10)}T00:00:00Z`);
  const end = b.endDate ? new Date(`${b.endDate.slice(0, 10)}T00:00:00Z`) : new Date(start.getTime() + 27 * 86400_000);
  const perWeek = Math.max(0, game.schedule.postsPerWeek);
  if (!perWeek) return [];
  const gapDays = Math.max(1, Math.floor(7 / perWeek));
  const hours = game.schedule.preferredHours.length ? game.schedule.preferredHours : [19];
  const out: string[] = [];
  let k = 0;
  for (let d = new Date(start); d <= end && out.length < (opts.maxSlots ?? 60); d = new Date(d.getTime() + gapDays * 86400_000)) {
    const h = hours[k++ % hours.length];
    out.push(new Date(d.getTime() + (h - tz) * 3600_000).toISOString());
  }
  return out;
}

export class GameCampaignManager {
  constructor(private readonly games: GameRegistry) {}

  async create(input: Omit<z.input<typeof CampaignBrief>, "createdAt">, actor: string): Promise<{ campaign: CampaignBriefT | null; issues: CampaignIssue[] }> {
    const game = await this.games.mustGet(input.gameId);
    const brief = CampaignBrief.parse({ ...input, createdAt: nowIso() });
    const issues = validateCampaign(game, brief);
    const hard = issues.filter((i) => i.code !== "NO_STORE_LINK");
    if (hard.length) return { campaign: null, issues };
    const saved = await this.games.saveCampaign(issues.some((i) => i.code === "NO_STORE_LINK") ? { ...brief, objective: "follow" } : brief);
    await writeJsonAtomic(this.games.dir(game.gameId, "campaigns", saved.campaignId, "schedule.json"), { slots: campaignSlots(game, saved).map((at) => ({ at, projectId: null, platform: null, status: "open" })) });
    await this.games.store.audit({ actor, action: "game.campaign.create", subject: `${game.gameId}/${saved.campaignId}` });
    return { campaign: saved, issues };
  }
}
