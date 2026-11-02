import {describe,it,expect} from "vitest";
import {DataStore,SecretStore} from "@ttm/storage";
import {AccountKeysStore,ACCOUNT_ENTRIES} from "../src/index.js";
import {tmpDir} from "../../storage/test/helpers.js";

const BOT="123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
function fake(handler:(url:string,init?:RequestInit)=>{status?:number;json:any}){const calls:string[]=[];return {calls,impl:async(url:string,init?:RequestInit)=>{calls.push(url.replace(/bot[^/]+\//,"bot<redacted>/"));const r=handler(url,init);return new Response(JSON.stringify(r.json),{status:r.status??200});}};}
async function setup(handler:Parameters<typeof fake>[0]){const store=new DataStore(await tmpDir("acs-accounts-"));await store.init?.();const http=fake(handler);return {store,http,accounts:new AccountKeysStore(store,http.impl as any)};}

describe("Accounts & Keys registry (fake HTTP only, nothing posted or messaged)",()=>{
 it("lists every credential the app reads, starts not_set and never returns secret values",async()=>{
  const {accounts}=await setup(()=>({json:{}}));const view=await accounts.overview();
  expect(view.entries.map(e=>e.id)).toEqual(ACCOUNT_ENTRIES.map(e=>e.id));
  expect(view.entries.every(e=>e.state==="not_set"&&e.usedBy.length>0)).toBe(true);
  await accounts.save("telegram-bot",{"telegram.botToken":BOT});
  const after=await accounts.overview(),bot=after.entries.find(e=>e.id==="telegram-bot")!;
  expect(bot.state).toBe("set");expect(bot.fields[0]).toMatchObject({present:true,value:null});expect(JSON.stringify(after)).not.toContain(BOT);
 });
 it("rejects malformed values and unknown entries",async()=>{
  const {accounts}=await setup(()=>({json:{}}));
  await expect(accounts.save("telegram-bot",{"telegram.botToken":"not-a-token"})).rejects.toThrow("format");
  await expect(accounts.save("nope",{x:"y"})).rejects.toThrow("Unknown");
  await expect(accounts.save("meta-app",{})).rejects.toThrow("at least one");
 });
 it("Test connection marks verified with a read-only call, redacts the token, and resets to set when the value changes",async()=>{
  const {accounts,http}=await setup(url=>url.includes("/getMe")?{json:{ok:true,result:{username:"fixture_bot"}}}:{status:404,json:{}});
  await accounts.save("telegram-bot",{"telegram.botToken":BOT});
  const row=await accounts.test("telegram-bot");expect(row).toMatchObject({state:"verified",accountName:"@fixture_bot"});
  expect(http.calls).toEqual(["https://api.telegram.org/bot<redacted>/getMe"]);
  expect((await accounts.overview()).entries.find(e=>e.id==="telegram-bot")!.state).toBe("verified");
  await accounts.save("telegram-bot",{"telegram.botToken":BOT.replace("AAAA","BBBB")});
  expect((await accounts.overview()).entries.find(e=>e.id==="telegram-bot")!.state).toBe("set");
 });
 it("reports expired tokens (Meta code 190, Telegram 401, Google invalid_grant) without echoing secrets",async()=>{
  const {accounts}=await setup(url=>url.includes("graph.facebook.com")?{status:400,json:{error:{code:190,message:"Error validating access token: Session has expired"}}}:url.includes("telegram")?{status:401,json:{ok:false,description:"Unauthorized"}}:{status:400,json:{error:"invalid_grant"}});
  await accounts.save("meta-page-legacy",{"meta.pageToken":"EAAG-fixture-token-123456"});expect((await accounts.test("meta-page-legacy")).state).toBe("expired");
  await accounts.save("telegram-bot",{"telegram.botToken":BOT});expect((await accounts.test("telegram-bot")).state).toBe("expired");
  await accounts.save("youtube-oauth-client",{"youtube.clientId":"1-fixture.apps.googleusercontent.com","youtube.clientSecret":"fixture-secret-value"});
  await accounts.save("youtube-legacy-refresh",{"youtube.refreshToken":"fixture-refresh-token"});
  const yt=await accounts.test("youtube-legacy-refresh");expect(yt.state).toBe("expired");expect(yt.detail).not.toContain("fixture-refresh-token");
  const view=await accounts.overview();expect(view.entries.find(e=>e.id==="meta-page-legacy")!.state).toBe("expired");
 });
 it("verifies a Meta token and records its expiry from debug_token when the app is configured",async()=>{
  const exp=Math.floor(Date.now()/1000)+86400;
  const {accounts}=await setup(url=>url.includes("debug_token")?{json:{data:{is_valid:true,expires_at:exp,scopes:["pages_manage_posts"]}}}:{json:{id:"123456789012345",name:"Fixture Page"}});
  await accounts.save("meta-app",{"meta.appId":"123456789","meta.appSecret":"fixture-app-secret"});await accounts.save("meta-page-legacy",{"meta.pageToken":"EAAG-fixture-token-123456"});
  const row=await accounts.test("meta-page-legacy");expect(row).toMatchObject({state:"verified",accountName:"Fixture Page"});expect(row.expiresAt).toBe(new Date(exp*1000).toISOString());
  const app=(await accounts.overview()).entries.find(e=>e.id==="meta-app")!;expect(app.fields.find(f=>f.key==="meta.appId")!.value).toBe("123456789");expect(app.fields.find(f=>f.key==="meta.appSecret")!.value).toBeNull();
 });
 it("Telegram allowlist requires a bot token and a user ID; removing the bot disables Telegram",async()=>{
  const {accounts,store}=await setup(()=>({json:{}}));
  await expect(accounts.saveTelegramPolicy({enabled:true,chatIds:"",userIds:"42"})).rejects.toThrow("bot token");
  await accounts.save("telegram-bot",{"telegram.botToken":BOT});
  await expect(accounts.saveTelegramPolicy({enabled:true,chatIds:"",userIds:"abc"})).rejects.toThrow("numbers");
  await accounts.saveTelegramPolicy({enabled:true,chatIds:"-100123",userIds:"42, 43"});expect((await store.getSettings()).telegram).toMatchObject({enabled:true,allowedChatIds:["-100123"],allowedUserIds:["42","43"]});
  await accounts.remove("telegram-bot");expect((await store.getSettings()).telegram.enabled).toBe(false);expect(await new SecretStore(store).has("telegram.botToken")).toBe(false);
 });
 it("shows unused legacy keys only when stored so they can be removed",async()=>{
  const {accounts,store}=await setup(()=>({json:{}}));expect((await accounts.overview()).unused).toEqual([]);
  await new SecretStore(store).set("tiktok.clientKey","old-value");expect((await accounts.overview()).unused).toEqual(["tiktok.clientKey"]);
  await accounts.remove("unused:tiktok.clientKey");expect((await accounts.overview()).unused).toEqual([]);
 });
});
