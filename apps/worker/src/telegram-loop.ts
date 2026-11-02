import { readJson, writeJsonAtomic } from "@ttm/storage";
import { z } from "zod";
import { CommandRouter, TelegramInbox, type CommandHandlers, type TelegramClient } from "@ttm/telegram";
import { type Ctx } from "./context.js";
import { StudioTelegramRouter } from "./studio-telegram.js";

/**
 * Telegram receive/answer cycle used by the daemon: durable inbox before advancing the offset, allowlist checked
 * against the current settings for every command, replies queued in the outbox and delivered by flush().
 * Exported so the whole cycle can be exercised against a local fake Bot API server.
 */
export function createTelegramLoop(ctx: Ctx, client: TelegramClient | null, handlers: CommandHandlers | null) {
  const inbox = new TelegramInbox(ctx.store), studioTelegram = new StudioTelegramRouter(ctx);
  const replaySafe = (text: string) => !/^\/confirm(?:@\S+)?\s/i.test(text);
  let router: CommandRouter | null = null, offset: number | null = null;
  const routerFor = async () => {
    const policy = (await ctx.settings()).telegram;
    if (!handlers || !policy.enabled || !policy.allowedUserIds.length) return null;
    router ??= new CommandRouter({ chatIds: policy.allowedChatIds, userIds: policy.allowedUserIds }, handlers, (e) => ctx.store.audit({ actor: "telegram", ...e }));
    return router;
  };
  async function drainInbox() {
    const active = await routerFor();
    for (const receipt of await inbox.pending()) {
      try {
        const result = await inbox.process(receipt.updateId, async (row) => {
          const policy = (await ctx.settings()).telegram;
          if (!policy.enabled || !policy.allowedChatIds.includes(row.chatId) || !policy.allowedUserIds.includes(row.userId)) { await ctx.store.audit({ actor: "telegram", action: "telegram.unauthorized", subject: row.chatId, detail: { userId: row.userId } }); return null; }
          const handled = await studioTelegram.handle(row); return handled.handled ? handled.reply : active ? active.handle({ chatId: row.chatId, userId: row.userId, text: row.text }) : null;
        }, replaySafe);
        if (result.reply) await ctx.outbox.enqueueOnce(`command-reply:${result.updateId}`, { chatId: result.chatId, kind: "text", text: result.reply });
        await inbox.markReplyQueued(result.updateId);
      } catch (error: any) { ctx.log(`Telegram receipt ${receipt.updateId}: ${error.message}`); }
    }
  }
  return {
    get active() { return !!client && !!handlers; },
    drainInbox,
    /** One long-poll round: process stored receipts, fetch updates, persist each before advancing, process again. */
    async pollOnce(timeoutSec = 25) {
      if (!client) return 0;
      offset ??= (await readJson(ctx.store.p("state", "telegram-offset.json"), z.object({ offset: z.number() })))?.offset ?? 0;
      await drainInbox();
      const updates = await client.getUpdates(offset, timeoutSec);
      for (const u of updates) {
        const msg = u.message;
        // Persist the command before advancing offset; interrupted work is recovered explicitly.
        if (msg?.text) await inbox.receive({ updateId: u.update_id, chatId: String(msg.chat.id), userId: String(msg.from?.id ?? ""), text: msg.text });
        offset = u.update_id + 1;
        await writeJsonAtomic(ctx.store.p("state", "telegram-offset.json"), { offset });
      }
      await drainInbox();
      return updates.length;
    },
  };
}
