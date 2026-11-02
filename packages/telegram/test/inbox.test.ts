import {describe,it,expect,vi} from "vitest";
import {DataStore} from "@ttm/storage";
import {tmpDir} from "../../storage/test/helpers.js";
import {TelegramInbox,TelegramOutbox,TelegramClient} from "../src/index.js";
describe("Durable Telegram receipts",()=>{
 it("recovers a read-only command after interruption and durably queues one reply across restarts",async()=>{
  const store=new DataStore(await tmpDir());await store.init();const inbox=new TelegramInbox(store);await inbox.receive({updateId:101,chatId:"12345",userId:"44444",text:"/status"});
  await expect(inbox.process(101,async()=>{throw new Error("simulated crash");},()=>true)).rejects.toThrow();
  const restarted=new TelegramInbox(store),result=await restarted.process(101,async()=>"real handler result",()=>true);expect(result.state).toBe("done");expect(result.attempts).toBe(2);expect(await restarted.pending()).toHaveLength(1);
  const outbox=new TelegramOutbox(store);const a=await outbox.enqueueOnce("reply:101",{chatId:"12345",kind:"text",text:result.reply!});const b=await new TelegramOutbox(store).enqueueOnce("reply:101",{chatId:"12345",kind:"text",text:result.reply!});expect(a).toBe(b);expect(await outbox.pending()).toHaveLength(1);await restarted.markReplyQueued(101);expect(await restarted.pending()).toHaveLength(0);
 });
 it("does not replay an interrupted action whose result is uncertain",async()=>{
  const store=new DataStore(await tmpDir());await store.init();const inbox=new TelegramInbox(store);await inbox.receive({updateId:102,chatId:"12345",userId:"44444",text:"/confirm 123456"});let effects=0;
  await expect(inbox.process(102,async()=>{effects++;throw new Error("crashed after side effect");},()=>false)).rejects.toThrow();const result=await new TelegramInbox(store).process(102,async()=>{effects++;return"duplicate";},()=>false);expect(result.state).toBe("uncertain");expect(effects).toBe(1);
 });
 it("suppresses queued delivery when its recipient is revoked",async()=>{
  const store=new DataStore(await tmpDir());await store.init();const outbox=new TelegramOutbox(store),sendMessage=vi.fn();await outbox.enqueueOnce("private-preview-reply",{chatId:"12345",kind:"text",text:"Private preview"});expect(await outbox.flush({sendMessage} as any,{allowedChatIds:[]})).toMatchObject({sent:0,failed:1});expect(sendMessage).not.toHaveBeenCalled();
 });
 it("redacts the actual bot token from network exception text",async()=>{
  const token="actual-test-secret-token",client=new TelegramClient(token,(async()=>{throw new Error(`Could not connect https://api.telegram.org/bot${token}/getMe`);}) as any);try{await client.getMe();throw new Error("expected network failure");}catch(error:any){expect(error.message).not.toContain(token);expect(error.message).toContain("[redacted]");}
 });
});
