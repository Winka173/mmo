"use server";
import { Platform, nowIso } from "@ttm/core";
import { GameCampaignManager, GameVideoInput, StoreLink, approveGameVideo, gameReadiness } from "@ttm/games";
import { BrandIdentityEngine } from "@ttm/media";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAccounts, getGames, getQueue, getStore } from "../lib/data";

const ACTOR = "web-ui (localhost)";
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const list = (f: FormData, k: string) => str(f, k).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
const back = (path: string, msg: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`);
const zodMsg = (e: any) => (e?.issues ? e.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; ") : (e?.message ?? String(e)));

/** Create/Edit Game — partial input allowed (draft); identity fields validated. */
export async function saveGame(formData: FormData) {
  const games = await getGames();
  const gameId = str(formData, "gameId");
  const prev = await games.get(gameId);
  const links = str(formData, "storeLinks")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [label, kind, url, confirmed] = l.split("|").map((x) => x.trim());
      return StoreLink.parse({ label, kind, url, confirmedByOwner: /^(1|true|có|yes|x)$/i.test(confirmed ?? "") });
    });
  try {
    await games.save(
      {
        ...(prev ?? {}),
        gameId,
        internalName: str(formData, "internalName") || gameId,
        publicTitle: str(formData, "publicTitle") || gameId,
        localizedTitles: str(formData, "titleEn") ? { en: str(formData, "titleEn") } : (prev?.localizedTitles ?? {}),
        tagline: str(formData, "tagline"),
        description: str(formData, "description"),
        studio: str(formData, "studio"),
        publisher: str(formData, "publisher"),
        genres: list(formData, "genres"),
        tags: list(formData, "tags"),
        gameplayModes: list(formData, "gameplayModes"),
        style: (str(formData, "style") || null) as any,
        engine: str(formData, "engine") || null,
        status: (str(formData, "status") || null) as any,
        platforms: list(formData, "platforms").map((p) => {
          const [name, status] = p.split(":").map((s) => s.trim());
          return { name, status: (["released", "in_development", "planned"].includes(status) ? status : "in_development") as any };
        }),
        audience: str(formData, "audience"),
        regions: list(formData, "regions"),
        ageRating: str(formData, "ageRating") || null,
        languages: list(formData, "languages").length ? list(formData, "languages") : ["vi"],
        releaseDate: str(formData, "releaseDate") ? { date: str(formData, "releaseDate"), confirmed: formData.get("releaseConfirmed") === "on" } : null,
        embargoUntil: str(formData, "embargoUntil") ? new Date(str(formData, "embargoUntil")).toISOString() : null,
        storeLinks: links,
        ctaGoal: (str(formData, "ctaGoal") || "follow") as any,
        destinationAllowlist: formData.getAll("destinationAllowlist").map(String),
        schedule: { postsPerWeek: Number(str(formData, "postsPerWeek") || 3), preferredHours: list(formData, "preferredHours").map(Number).filter((n) => n >= 0 && n <= 23) },
        ownerRights: str(formData, "owner") ? { owner: str(formData, "owner"), statement: str(formData, "ownerStatement") || "Chủ sở hữu xác nhận quyền với game và asset", evidencePath: null } : null,
        utm: str(formData, "utmCampaign") ? { source: str(formData, "utmSource") || "social", medium: str(formData, "utmMedium") || "video", campaign: str(formData, "utmCampaign") } : null,
        draft: formData.get("draft") === "on",
        allowCloudUpload: formData.get("allowCloudUpload") === "on",
      },
      ACTOR,
    );
  } catch (e) {
    back(prev ? `/games/${gameId}/edit` : "/games/new", `Lỗi: ${zodMsg(e)}`);
  }
  // brand kit (versioned, per game)
  const brands = new BrandIdentityEngine(await getStore());
  const kitPrev = await brands.load({ kind: "game", id: gameId });
  const color = (k: string, d: string) => (/^#[0-9a-fA-F]{6}$/.test(str(formData, k)) ? str(formData, k) : d);
  const logo = (await games.media(gameId)).find((a) => a.kind === "logo");
  await brands.save(
    {
      ...(kitPrev ?? {}),
      owner: { kind: "game", id: gameId },
      kitVersion: 1,
      name: str(formData, "publicTitle") || gameId,
      tagline: str(formData, "tagline"),
      colors: { bg1: color("c_bg1", "#2B2D33"), bg2: color("c_bg2", "#16171B"), accent: color("c_accent", "#E8E8E8"), text: color("c_text", "#FFFFFF"), muted: color("c_muted", "#B9BCC4"), badge: color("c_badge", "#9AD1FF") },
      logoPath: logo?.path ?? null,
      voice: { engine: "espeak-ng", voice: str(formData, "voice") || "vi", speedWpm: Number(str(formData, "voiceSpeed") || 165), pitch: Number(str(formData, "voicePitch") || 45) },
      bannedPhrases: list(formData, "bannedPhrases"),
      pronunciation: str(formData, "pronunciation").split("\n").map((l) => l.split("=>").map((s) => s.trim())).filter((x) => x.length === 2 && x[0] && x[1]).map(([from, to]) => ({ from, to })),
      editorialVoice: str(formData, "editorialVoice"),
      updatedAt: nowIso(),
    },
    ACTOR,
  );
  revalidatePath("/games");
  back(`/games/${gameId}`, prev ? "Đã lưu game" : "Đã tạo game — tiếp theo: tải gameplay, logo, thumbnail");
}

export async function addBuild(gameId: string, formData: FormData) {
  const games = await getGames();
  try {
    await games.saveBuild(gameId, { buildId: str(formData, "buildId"), version: str(formData, "version"), date: str(formData, "date"), platforms: list(formData, "platforms"), knownLimitations: list(formData, "limitations"), latest: formData.get("latest") === "on", importedAt: nowIso() }, str(formData, "changelog") || null);
  } catch (e) {
    back(`/games/${gameId}`, `Lỗi build: ${zodMsg(e)}`);
  }
  back(`/games/${gameId}`, "Đã thêm build + changelog");
}

export async function saveFeature(gameId: string, formData: FormData) {
  const games = await getGames();
  const cur = await games.getFeatures(gameId);
  const id = str(formData, "id");
  const f = { id, name: str(formData, "name"), keywords: list(formData, "keywords"), description: "", status: str(formData, "status") as any, buildId: str(formData, "buildId") || null, evidence: [], spoiler: formData.get("spoiler") === "on", marketingApproved: formData.get("marketingApproved") === "on" };
  try {
    await games.saveFeatures(gameId, { features: [...cur.features.filter((x) => x.id !== id), f] });
  } catch (e) {
    back(`/games/${gameId}`, `Lỗi tính năng: ${zodMsg(e)}`);
  }
  back(`/games/${gameId}`, "Đã lưu tính năng");
}

export async function patchAsset(gameId: string, assetId: string, formData: FormData) {
  const games = await getGames();
  await games.patchAsset(
    gameId,
    assetId,
    (a) => ({
      ...a,
      kind: (str(formData, "kind") || a.kind) as any,
      buildId: str(formData, "buildId") || null,
      annotation: str(formData, "annotation"),
      flags: {
        ...a.flags,
        publishAllowed: formData.get("publishAllowed") === "on",
        spoiler: formData.get("spoiler") === "on",
        bugVisible: formData.get("bugVisible") === "on",
        debugOverlay: str(formData, "debugOverlay") === "yes" ? true : str(formData, "debugOverlay") === "no" ? false : null,
        lockedThumbnail: formData.get("lockedThumbnail") === "on",
        includeAudio: formData.get("includeAudio") === "on",
        isGameplayCapture: (str(formData, "kind") || a.kind) === "gameplay" && !a.flags.aiGenerated,
        aiGenerated: (str(formData, "kind") || a.kind) === "ai_concept" || a.flags.aiGenerated,
      },
    }),
    ACTOR,
  );
  back(`/games/${gameId}`, `Đã cập nhật ${assetId}`);
}

export async function createCampaign(gameId: string, formData: FormData) {
  const games = await getGames();
  const r = await new GameCampaignManager(games).create(
    { campaignId: str(formData, "campaignId"), gameId, name: str(formData, "name"), kind: str(formData, "kind") as any, objective: str(formData, "objective") as any, pillars: list(formData, "pillars"), messages: list(formData, "messages"), personas: list(formData, "personas"), targetAccounts: formData.getAll("targetAccounts").map(String), startDate: str(formData, "startDate") || null, endDate: str(formData, "endDate") || null, countdownTo: str(formData, "countdownTo") || null },
    ACTOR,
  ).catch((e) => ({ campaign: null, issues: [{ code: "ERR", message: zodMsg(e) }] }));
  back(`/games/${gameId}`, r.campaign ? `Đã tạo chiến dịch${r.issues.length ? ` (lưu ý: ${r.issues.map((i) => i.message).join("; ")})` : ""}` : `Không tạo được: ${r.issues.map((i) => i.message).join("; ")}`);
}

export async function newVideo(gameId: string, formData: FormData) {
  const games = await getGames();
  const projectId = `${gameId}-${str(formData, "slug") || Date.now().toString(36)}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 80);
  await games.saveVideo({ projectId, gameId, contentType: (str(formData, "contentType") || "GAME_DEVLOG") as any, title: str(formData, "title") || "Video mới", formats: ["short_9x16"] }, ACTOR);
  redirect(`/games/${gameId}/videos/${projectId}`);
}

/** Save draft of the Create Game Video wizard (every field; partial input allowed). */
export async function saveVideo(gameId: string, projectId: string, formData: FormData) {
  const games = await getGames();
  const prev = await games.getVideo(gameId, projectId);
  let clips: any[] = [];
  try {
    clips = JSON.parse(str(formData, "clipsJson") || "[]");
  } catch {
    /* keep empty */
  }
  const accounts: Record<string, string> = {};
  for (const p of Platform.options) if (str(formData, `acct_${p}`)) accounts[p] = str(formData, `acct_${p}`);
  const heroAsset = str(formData, "heroAsset");
  try {
    GameVideoInput.parse({ ...prev, updatedAt: nowIso() }); // sanity of previous
    await games.saveVideo(
      {
        ...(prev ?? {}),
        projectId,
        gameId,
        contentType: str(formData, "contentType") as any,
        title: str(formData, "title"),
        topic: str(formData, "topic"),
        hook: str(formData, "hook"),
        scriptNotes: str(formData, "scriptNotes"),
        narration: clips.map((c) => String(c.narration ?? "")),
        language: str(formData, "language") || "vi",
        voice: { enabled: formData.get("voice") === "on" },
        targets: formData.getAll("targets").map(String) as any,
        formats: formData.getAll("formats").map(String).length ? (formData.getAll("formats").map(String) as any) : ["short_9x16"],
        clips: clips.map((c) => ({ assetId: c.assetId, in: Number(c.in), out: Number(c.out), caption: c.caption ?? "", annotation: c.annotation ?? "", featureIds: [] })),
        screenshots: formData.getAll("screenshots").map(String),
        logoAssetId: str(formData, "logoAssetId") || null,
        thumbnail: { mode: (str(formData, "thumbMode") || "GENERATE_CANDIDATES") as any, user16x9: str(formData, "user16x9") || null, user9x16: str(formData, "user9x16") || null, heroFrame: heroAsset ? { assetId: heroAsset, t: Number(str(formData, "heroT") || 0) } : null, textOverlay: str(formData, "textOverlay") || null },
        buildId: str(formData, "buildId") || null,
        cta: { text: str(formData, "ctaText"), linkLabel: str(formData, "ctaLink") || null },
        accounts,
        musicAssetId: str(formData, "musicAssetId") || null,
        keepGameAudio: formData.get("keepGameAudio") === "on",
        allowConceptShots: formData.get("allowConceptShots") === "on",
        priority: Number(str(formData, "priority") || 5),
        autoMode: "REVIEW_REQUIRED",
        status: "draft",
      },
      ACTOR,
    );
  } catch (e) {
    back(`/games/${gameId}/videos/${projectId}`, `Lỗi: ${zodMsg(e)}`);
  }
  back(`/games/${gameId}/videos/${projectId}`, "Đã lưu nháp");
}

export async function undoVideo(gameId: string, projectId: string) {
  const r = await (await getGames()).undoVideo(gameId, projectId, ACTOR);
  back(`/games/${gameId}/videos/${projectId}`, r ? `Đã hoàn tác về bản ${r.revision - 1}` : "Không có bản trước để hoàn tác");
}

export async function analyzeVideo(gameId: string, projectId: string) {
  const r = await gameReadiness(await getStore(), gameId, projectId, { analyze: true });
  back(`/games/${gameId}/videos/${projectId}`, `Đã phân tích footage — trạng thái: ${r.readiness.state}`);
}

/** Render runs in the worker (GPU semaphore, retries); UI only enqueues. */
export async function renderVideo(gameId: string, projectId: string) {
  const games = await getGames();
  const v = await games.getVideo(gameId, projectId);
  if (!v) back(`/games/${gameId}`, "Không có dự án");
  const q = await getQueue();
  const { created } = await q.enqueue({ kind: "GAME_PRODUCE", idempotencyKey: `game-produce:${projectId}:r${v!.revision}`, payload: { gameId, projectId, mode: "live" }, usesGpu: true, priority: 3 });
  back(`/games/${gameId}/videos/${projectId}`, created ? "Đã đưa vào hàng đợi dựng — worker sẽ dựng 9:16/16:9 (chạy `pnpm worker`)" : "Bản sửa này đã có trong hàng đợi (idempotent)");
}

export async function approveVideo(gameId: string, projectId: string, formData: FormData) {
  await approveGameVideo(await getStore(), gameId, projectId, ACTOR, { roadmapMention: formData.get("roadmap") === "on" });
  revalidatePath("/review");
  back(`/games/${gameId}/videos/${projectId}`, "Đã duyệt nội dung (thay đổi input/thumbnail sau này sẽ hủy duyệt)");
}

// ------------------------------------------------------------------ accounts
export async function saveAccount(formData: FormData) {
  const mam = await getAccounts();
  try {
    const [kind, id] = str(formData, "owner").split(":");
    await mam.upsert({ id: str(formData, "id"), platform: str(formData, "platform") as any, owner: { kind: kind as any, id }, displayName: str(formData, "displayName"), expectedRemoteId: str(formData, "expectedRemoteId") || null, addedAt: nowIso() }, ACTOR);
  } catch (e) {
    back("/accounts", `Lỗi: ${zodMsg(e)}`);
  }
  back("/accounts", "Đã lưu tài khoản — cần bấm Xác nhận trước khi được đăng");
}
export async function confirmAccount(id: string) {
  await (await getAccounts()).confirm(id, ACTOR);
  back("/accounts", `Đã xác nhận ${id} là điểm đăng hợp lệ`);
}
export async function disableAccount(id: string) {
  await (await getAccounts()).disable(id, ACTOR, "tắt từ UI");
  back("/accounts", `Đã tắt ${id}`);
}
