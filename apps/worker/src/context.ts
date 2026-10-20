import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { FileQueue } from "@ttm/automation";
import { Platform, type Settings } from "@ttm/core";
import { EspeakNgTts, PiperTts, type TtsProvider } from "@ttm/media";
import { ManualHandoffPublisher, MetaPublisher, TikTokPublisher, YouTubePublisher, type PlatformPublisher } from "@ttm/platforms";
import { DataStore, SecretStore, readJson } from "@ttm/storage";
import { TelegramClient, TelegramOutbox } from "@ttm/telegram";
import { z } from "zod";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const FIXTURES = path.join(REPO_ROOT, "fixtures");

/** channels.json: which account each destination must be, and routing for game vs main brand. */
export const ChannelsConfig = z.object({
  youtube: z.object({ expectedChannelId: z.string().nullable().default(null) }).default({}),
  meta: z.object({ graphVersion: z.string().default("v21.0"), pageId: z.string().nullable().default(null), igUserId: z.string().nullable().default(null), publishState: z.enum(["PUBLISHED", "DRAFT"]).default("DRAFT") }).default({}),
  tiktok: z.object({ audited: z.boolean().default(false), expectedUsername: z.string().nullable().default(null) }).default({}),
  /** Legacy per-brand routing. Game routing is per game: game.json destinationAllowlist + config/accounts.json. */
  routing: z.record(z.array(Platform)).default({ tutomo: ["youtube_shorts", "facebook", "instagram", "tiktok"] }),
});

export type Ctx = {
  store: DataStore;
  queue: FileQueue;
  secrets: SecretStore;
  outbox: TelegramOutbox;
  settings: () => Promise<Settings>;
  tts: TtsProvider[];
  publishers: Partial<Record<Platform, PlatformPublisher>>;
  telegram: TelegramClient | null;
  log: (msg: string) => void;
};

export async function buildPublishers(store: DataStore, secrets: SecretStore): Promise<Partial<Record<Platform, PlatformPublisher>>> {
  const kitRoot = store.p("state", "manual-kits-tmp");
  const channels = (await readJson(store.p("config", "channels.json"), ChannelsConfig)) ?? ChannelsConfig.parse({});
  const [clientId, clientSecret, refreshToken] = await Promise.all([secrets.get("youtube.clientId"), secrets.get("youtube.clientSecret"), secrets.get("youtube.refreshToken")]);
  const yt = clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
  const metaNote = "Meta Graph API chưa được cấu hình (Page ID/IG user + token) — dùng gói đăng thủ công.";
  const metaToken = await secrets.get("meta.pageToken").catch(() => null);
  const ttToken = await secrets.get("tiktok.accessToken").catch(() => null);
  return {
    youtube_shorts: new YouTubePublisher("youtube_shorts", yt, { expectedChannelId: channels.youtube.expectedChannelId }),
    youtube_long: new YouTubePublisher("youtube_long", yt, { expectedChannelId: channels.youtube.expectedChannelId }),
    facebook:
      metaToken && channels.meta.pageId
        ? new MetaPublisher("facebook", { accessToken: metaToken, pageId: channels.meta.pageId, expectedId: channels.meta.pageId, graphVersion: channels.meta.graphVersion, publishState: channels.meta.publishState })
        : new ManualHandoffPublisher("facebook", kitRoot, metaNote, ["Link affiliate có thể đặt trong caption hoặc bình luận đầu tiên trên bài của chính Page."]),
    instagram:
      metaToken && channels.meta.igUserId
        ? new MetaPublisher("instagram", { accessToken: metaToken, igUserId: channels.meta.igUserId, expectedId: channels.meta.igUserId, graphVersion: channels.meta.graphVersion })
        : new ManualHandoffPublisher("instagram", kitRoot, metaNote, ["Link trong caption Reels KHÔNG click được — cập nhật link bio hoặc Story link sticker."]),
    tiktok: ttToken && channels.tiktok.audited ? new TikTokPublisher({ accessToken: ttToken, audited: true, expectedOpenId: channels.tiktok.expectedUsername }) : new ManualHandoffPublisher(
      "tiktok",
      kitRoot,
      "TikTok Content Posting API (Direct Post) yêu cầu app được audit; công cụ cá nhân có thể không đủ điều kiện. Không tự động hóa giao diện web/cookie — đăng thủ công.",
      ["Bật nhãn 'AI-generated content' nếu video dùng giọng/ảnh tổng hợp theo quy định TikTok.", "Không gắn watermark quảng cáo trên file đăng qua API."],
    ),
  };
}

export async function buildContext(opts: { dataDir?: string; log?: (m: string) => void } = {}): Promise<Ctx> {
  const store = new DataStore(opts.dataDir);
  await store.init();
  const secrets = new SecretStore(store);
  const token = await secrets.get("telegram.botToken").catch(() => null);
  const tts: TtsProvider[] = [];
  if (process.env.PIPER_MODEL)
    tts.push(new PiperTts({ model: process.env.PIPER_MODEL, bin: process.env.PIPER_BIN, voiceLicense: process.env.PIPER_VOICE_LICENSE, commercialUseOk: process.env.PIPER_COMMERCIAL_OK === "1" }));
  tts.push(new EspeakNgTts());
  return {
    store,
    queue: new FileQueue(store),
    secrets,
    outbox: new TelegramOutbox(store),
    settings: () => store.getSettings(),
    tts,
    publishers: await buildPublishers(store, secrets),
    telegram: token ? new TelegramClient(token) : null,
    log: opts.log ?? ((m) => console.log(`[${new Date().toISOString()}] ${m}`)),
  };
}

/** Queue a Telegram message to every allowlisted chat (persisted; delivered by the outbox). */
export async function notify(ctx: Ctx, text: string, opts: { dedupeKey?: string; photo?: string; video?: string } = {}): Promise<void> {
  const s = await ctx.settings();
  for (const chatId of s.telegram.allowedChatIds) {
    await ctx.outbox.enqueue({
      chatId,
      kind: opts.video ? "video" : opts.photo ? "photo" : "text",
      text,
      file: opts.video ?? opts.photo ?? null,
      dedupeKey: opts.dedupeKey ?? null,
    });
  }
}
