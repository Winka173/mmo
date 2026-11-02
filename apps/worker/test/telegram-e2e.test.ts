import {describe,it,expect,afterEach} from "vitest";
import {createServer,type Server} from "node:http";
import {TelegramClient} from "@ttm/telegram";
import {tmpDir} from "../../../packages/storage/test/helpers.js";
import {buildContext} from "../src/context.js";
import {buildTelegramHandlers} from "../src/telegram-handlers.js";
import {createTelegramLoop} from "../src/telegram-loop.js";

/** Minimal local Bot API: queued updates for getUpdates, every sendMessage recorded. Loopback only; nothing leaves the PC. */
async function fakeBotApi(token:string){
 const updates:any[]=[],sent:{chat_id:string;text:string}[]=[],calls:string[]=[];let nextId=1000;
 const server:Server=createServer((req,res)=>{let raw="";req.on("data",c=>raw+=c);req.on("end",()=>{
  const m=/^\/bot([^/]+)\/(\w+)$/.exec(req.url??"");const reply=(body:any,status=200)=>{res.writeHead(status,{"content-type":"application/json"});res.end(JSON.stringify(body));};
  if(!m||m[1]!==token)return reply({ok:false,error_code:401,description:"Unauthorized"},401);
  calls.push(m[2]);const body=raw?JSON.parse(raw):{};
  if(m[2]==="getUpdates"){const out=updates.filter(u=>u.update_id>=Number(body.offset??0));return reply({ok:true,result:out});}
  if(m[2]==="sendMessage"){sent.push({chat_id:String(body.chat_id),text:String(body.text)});return reply({ok:true,result:{message_id:nextId++}});}
  return reply({ok:false,description:`unsupported ${m[2]}`},400);
 });});
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r()));
 const port=(server.address() as any).port;let update=1;
 return {base:`http://127.0.0.1:${port}`,sent,calls,close:()=>new Promise<void>(r=>server.close(()=>r())),
  say:(text:string,user="44444",chat="12345")=>updates.push({update_id:update++,message:{message_id:update,chat:{id:Number(chat)},from:{id:Number(user)},text}})};
}
const servers:any[]=[];afterEach(async()=>{for(const s of servers.splice(0))await s.close();});

describe("Telegram commands end to end against a local fake Bot API server",()=>{
 it("receives, authorizes, executes and replies through the real client, inbox, router and outbox",async()=>{
  const token="123456789:FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAK",api=await fakeBotApi(token);servers.push(api);
  const ctx=await buildContext({dataDir:await tmpDir("acs-tg-e2e-")});
  await ctx.store.updateSettings(s=>({...s,paused:false,telegram:{...s.telegram,enabled:true,allowedChatIds:["12345"],allowedUserIds:["44444"]}}),"test");
  const client=new TelegramClient(token,fetch,api.base),loop=createTelegramLoop(ctx,client,buildTelegramHandlers(ctx));
  api.say("/status");api.say("/pause");api.say("/queue");api.say("/status","99999");
  expect(await loop.pollOnce(0)).toBe(4);
  await ctx.outbox.flush(client,{allowedChatIds:["12345"]});
  const texts=api.sent.map(s=>s.text);
  expect(api.sent.every(s=>s.chat_id==="12345")).toBe(true);
  // three authorized commands answered; the unknown user gets nothing and is audited
  expect(texts.length).toBe(3);expect((await ctx.settings()).paused).toBe(true);expect(texts.some(t=>/tạm dừng/i.test(t))).toBe(true);
  // /resume needs a one-time confirmation code from the same user
  api.say("/resume");await loop.pollOnce(0);await ctx.outbox.flush(client,{allowedChatIds:["12345"]});
  const code=/\/confirm (\d{6})/.exec(api.sent.at(-1)!.text)![1];expect((await ctx.settings()).paused).toBe(true);
  api.say(`/confirm ${code}`,"99999");api.say(`/confirm ${code}`);await loop.pollOnce(0);await ctx.outbox.flush(client,{allowedChatIds:["12345"]});
  expect((await ctx.settings()).paused).toBe(false);expect(api.sent.length).toBe(5);
  // a second poll does not replay anything (offset persisted, receipts processed once)
  expect(await loop.pollOnce(0)).toBe(0);await ctx.outbox.flush(client,{allowedChatIds:["12345"]});expect(api.sent.length).toBe(5);
  const audit=await ctx.store.readAudit((ctx.store as any).day());expect(audit.records.some((e:any)=>e.action==="telegram.unauthorized"&&e.detail?.userId==="99999")).toBe(true);
 });
 it("pauses production for real and keeps it paused across a restart of the loop",async()=>{
  const token="123456789:FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAK",api=await fakeBotApi(token);servers.push(api);
  const ctx=await buildContext({dataDir:await tmpDir("acs-tg-e2e2-")});
  await ctx.store.updateSettings(s=>({...s,paused:false,telegram:{...s.telegram,enabled:true,allowedChatIds:["12345"],allowedUserIds:["44444"]}}),"test");
  const client=new TelegramClient(token,fetch,api.base);
  api.say("/pause");await createTelegramLoop(ctx,client,buildTelegramHandlers(ctx)).pollOnce(0);expect((await ctx.settings()).paused).toBe(true);
  const restarted=createTelegramLoop(ctx,client,buildTelegramHandlers(ctx));expect(await restarted.pollOnce(0)).toBe(0);expect((await ctx.settings()).paused).toBe(true);
  api.say("/resume");await restarted.pollOnce(0);await ctx.outbox.flush(client,{allowedChatIds:["12345"]});
  const code=/\/confirm (\d{6})/.exec(api.sent.at(-1)!.text)![1];api.say(`/confirm ${code}`);await restarted.pollOnce(0);expect((await ctx.settings()).paused).toBe(false);
  await ctx.outbox.flush(client,{allowedChatIds:["12345"]});expect(api.sent).toHaveLength(3);
 });
 it("refuses a non-loopback test server and a disabled bot sends nothing",async()=>{
  expect(()=>new TelegramClient("1:x",fetch,"http://example.com")).toThrow("loopback");
  const token="123456789:FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAK",api=await fakeBotApi(token);servers.push(api);
  const ctx=await buildContext({dataDir:await tmpDir("acs-tg-e2e3-")});
  await ctx.store.updateSettings(s=>({...s,telegram:{...s.telegram,enabled:false,allowedChatIds:["12345"],allowedUserIds:["44444"]}}),"test");
  const client=new TelegramClient(token,fetch,api.base);api.say("/pause");await createTelegramLoop(ctx,client,buildTelegramHandlers(ctx)).pollOnce(0);
  expect((await ctx.settings()).paused).not.toBe(true);expect(api.sent).toHaveLength(0);
 });
});
