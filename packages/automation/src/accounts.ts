import {createHash} from "node:crypto";
import {z} from "zod";
import {DataStore,SecretStore,readJson,writeJsonAtomic,withLock} from "@ttm/storage";
import {StudioPublishingStore,type StudioChannel,CHANNEL_CREDENTIAL_FIELDS} from "./studio-publishing.js";

/**
 * One registry for every credential the app reads. The Accounts & Keys page is the only place to enter them.
 * Values are stored with the existing SecretStore (Windows DPAPI) and are never returned to the UI.
 * Status: not_set -> set -> verified | expired | failed. A verified/expired result is tied to a fingerprint of the
 * stored values, so changing a value returns the entry to "set" until it is tested again.
 */
export type AccountField={key:string;vi:string;en:string;secret:boolean;pattern?:string};
export type AccountEntry={id:string;group:"youtube"|"meta"|"tiktok"|"telegram"|"affiliate";vi:string;en:string;fields:AccountField[];usedBy:{vi:string;en:string}[];test:"youtube-client"|"youtube-refresh"|"meta-token"|"tiktok-token"|"telegram-bot"|null};
export const ACCOUNT_ENTRIES:AccountEntry[]=[
 {id:"youtube-oauth-client",group:"youtube",vi:"Ứng dụng OAuth YouTube (Desktop)",en:"YouTube OAuth app (Desktop)",fields:[{key:"youtube.clientId",vi:"OAuth Client ID",en:"OAuth Client ID",secret:false,pattern:"^[0-9A-Za-z._-]+\\.apps\\.googleusercontent\\.com$"},{key:"youtube.clientSecret",vi:"OAuth Client secret",en:"OAuth Client secret",secret:true}],usedBy:[{vi:"Đăng nhập kênh YouTube bằng trình duyệt",en:"YouTube channel browser sign-in"},{vi:"Publisher YouTube của nhà máy cũ",en:"Legacy factory YouTube publisher"}],test:"youtube-client"},
 {id:"youtube-legacy-refresh",group:"youtube",vi:"Refresh token YouTube (nhà máy cũ)",en:"YouTube refresh token (legacy factory)",fields:[{key:"youtube.refreshToken",vi:"Refresh token",en:"Refresh token",secret:true}],usedBy:[{vi:"Publisher YouTube của nhà máy cũ",en:"Legacy factory YouTube publisher"}],test:"youtube-refresh"},
 {id:"meta-app",group:"meta",vi:"Ứng dụng Meta (kiểm tra hạn token)",en:"Meta app (token expiry check)",fields:[{key:"meta.appId",vi:"App ID",en:"App ID",secret:false,pattern:"^\\d{5,20}$"},{key:"meta.appSecret",vi:"App secret",en:"App secret",secret:true}],usedBy:[{vi:"Kiểm tra hạn và quyền của token Page / Instagram",en:"Expiry and scope check of Page / Instagram tokens"}],test:null},
 {id:"meta-page-legacy",group:"meta",vi:"Token Facebook Page / Instagram (nhà máy cũ)",en:"Facebook Page / Instagram token (legacy factory)",fields:[{key:"meta.pageToken",vi:"Page access token",en:"Page access token",secret:true}],usedBy:[{vi:"Publisher Facebook Reels / Instagram Reels của nhà máy cũ",en:"Legacy factory Facebook / Instagram Reels publisher"}],test:"meta-token"},
 {id:"tiktok-legacy",group:"tiktok",vi:"Token TikTok (nhà máy cũ)",en:"TikTok token (legacy factory)",fields:[{key:"tiktok.accessToken",vi:"Access token",en:"Access token",secret:true}],usedBy:[{vi:"Publisher TikTok của nhà máy cũ",en:"Legacy factory TikTok publisher"}],test:"tiktok-token"},
 {id:"telegram-bot",group:"telegram",vi:"Bot Telegram",en:"Telegram bot",fields:[{key:"telegram.botToken",vi:"Bot token",en:"Bot token",secret:true,pattern:"^\\d{5,12}:[A-Za-z0-9_-]{30,64}$"}],usedBy:[{vi:"Lệnh Telegram và thông báo",en:"Telegram commands and notifications"}],test:"telegram-bot"},
];
/** Keys that older versions accepted but no feature reads. Shown only when a value is stored, so it can be removed. */
export const UNUSED_SECRET_KEYS=["tiktok.refreshToken","tiktok.clientKey","tiktok.clientSecret"];
export const ACCOUNT_SECRET_KEYS=new Set([...ACCOUNT_ENTRIES.flatMap(e=>e.fields.map(f=>f.key)),...UNUSED_SECRET_KEYS]);

export const AccountStatusRow=z.object({state:z.enum(["verified","expired","failed"]),fingerprint:z.string(),checkedAt:z.string(),detail:z.string().max(500),expiresAt:z.string().nullable().default(null),accountName:z.string().nullable().default(null)});
export type AccountState="not_set"|"partial"|"set"|"verified"|"expired"|"failed";
export type FetchLike=(url:string,init?:RequestInit)=>Promise<Response>;
const sha=(v:string)=>createHash("sha256").update(v).digest("hex");
const redact=(text:string,values:string[])=>values.filter(v=>v.length>=6).reduce((s,v)=>s.split(v).join("•••"),text).slice(0,500);

export class AccountKeysStore{
 constructor(readonly store:DataStore,private readonly fetchImpl:FetchLike=(u,i)=>fetch(u,{...i,redirect:"error",signal:AbortSignal.timeout(20000)})){}
 private secrets(){return new SecretStore(this.store);}
 private statusFile(){return this.store.p("accounts","status.json");}
 private async statuses(){return (await readJson(this.statusFile(),z.record(AccountStatusRow)))??{};}
 private async values(keys:string[]){const s=this.secrets();return Promise.all(keys.map(k=>s.get(k).catch(()=>null)));}
 private async fingerprint(keys:string[]){return sha(JSON.stringify(await this.values(keys)));}
 private async record(id:string,keys:string[],row:Omit<z.infer<typeof AccountStatusRow>,"fingerprint"|"checkedAt">){
  const fingerprint=await this.fingerprint(keys);
  await withLock(this.store.p("locks","accounts-status.lock"),async()=>{const all=await this.statuses();all[id]=AccountStatusRow.parse({...row,fingerprint,checkedAt:new Date().toISOString()});await writeJsonAtomic(this.statusFile(),all);});
  await this.store.audit({actor:"studio-ui",action:"accounts.test",subject:id,detail:{state:row.state}});
 }
 private stateOf(present:boolean[],status:z.infer<typeof AccountStatusRow>|undefined,fingerprint:string):AccountState{
  if(!present.some(Boolean))return "not_set";if(!present.every(Boolean))return "partial";
  if(status&&status.fingerprint===fingerprint){if(status.state==="verified"&&status.expiresAt&&Date.parse(status.expiresAt)<=Date.now())return "expired";return status.state;}
  return "set";
 }
 /** The page model: entries, channel accounts and Telegram allowlist. Never contains a secret value. */
 async overview(){
  const s=this.secrets(),statuses=await this.statuses();
  const entries=await Promise.all(ACCOUNT_ENTRIES.map(async e=>{
   const keys=e.fields.map(f=>f.key),present=await Promise.all(keys.map(k=>s.has(k))),fp=await this.fingerprint(keys),st=statuses[e.id];
   // Non-secret identifiers (client id, app id) are shown so the owner can see which app is configured.
   const visible=Object.fromEntries(await Promise.all(e.fields.filter(f=>!f.secret).map(async f=>[f.key,await s.get(f.key).catch(()=>null)])));
   return {...e,fields:e.fields.map((f,i)=>({...f,present:present[i],value:f.secret?null:visible[f.key]??null})),state:this.stateOf(present,st,fp),checkedAt:st?.fingerprint===fp?st.checkedAt:null,detail:st?.fingerprint===fp?st.detail:null,accountName:st?.fingerprint===fp?st.accountName:null,expiresAt:st?.fingerprint===fp?st.expiresAt:null};
  }));
  const publishing=new StudioPublishingStore(this.store),channels=await Promise.all((await publishing.channels()).map(async c=>{
   const ref=publishing.secretRef(c),present=await s.has(ref),fp=sha(JSON.stringify(await s.get(ref).catch(()=>null))),check=await readJson(this.store.p("studio","channel-checks",`${c.id}.json`),z.any()),st=statuses[`channel:${c.id}`];
   let state:AccountState=present?"set":"not_set";
   if(present&&check&&check.revision===c.revision)state=check.canPublish&&check.accountId===c.expectedRemoteId?"verified":/OAUTH_REVOKED|hết hạn|expired|revoked/i.test((check.blockers??[]).join(" "))?"expired":"failed";
   if(present&&st?.fingerprint===fp&&st.state==="expired")state="expired";
   return {id:c.id,name:c.name,platform:c.platform,expectedRemoteId:c.expectedRemoteId,enabled:c.enabled,revision:c.revision,fields:CHANNEL_CREDENTIAL_FIELDS[c.platform],present,state,checkedAt:check?.checkedAt??null,detail:check?(check.blockers??[]).join("; ").slice(0,300):null,accountName:check?.accountName??null};
  }));
  const unused=(await Promise.all(UNUSED_SECRET_KEYS.map(async k=>(await s.has(k))?k:null))).filter(Boolean) as string[];
  const settings=await this.store.getSettings();
  return {backend:s.backend,entries,channels,unused,telegram:{enabled:settings.telegram.enabled,allowedChatIds:settings.telegram.allowedChatIds,allowedUserIds:settings.telegram.allowedUserIds??[]}};
 }
 async save(id:string,values:Record<string,unknown>){
  const entry=ACCOUNT_ENTRIES.find(e=>e.id===id);if(!entry)throw new Error("Unknown account entry");
  const s=this.secrets();let saved=0;
  for(const f of entry.fields){const raw=values[f.key];if(typeof raw!=="string"||!raw.trim())continue;const v=raw.trim();if(v.length>8000)throw new Error(`${f.en} is too long`);if(f.pattern&&!new RegExp(f.pattern).test(v))throw new Error(`${f.en} has an unexpected format`);await s.set(f.key,v);saved++;}
  if(!saved)throw new Error("Enter at least one value");
  await this.store.audit({actor:"studio-ui",action:"accounts.save",subject:id,detail:{fields:entry.fields.filter(f=>typeof values[f.key]==="string"&&String(values[f.key]).trim()).map(f=>f.key)}});
  return {ok:true,saved};
 }
 async remove(id:string){
  if(id.startsWith("unused:")){const key=id.slice(7);if(!UNUSED_SECRET_KEYS.includes(key))throw new Error("Unknown key");await this.secrets().delete(key);return {ok:true};}
  if(id.startsWith("channel:")){
   const publishing=new StudioPublishingStore(this.store),channel=await publishing.channel(id.slice(8));if(!channel)throw new Error("Channel not found");
   await this.secrets().delete(publishing.secretRef(channel)).catch(()=>{});
   // A channel without credentials cannot stay selectable for uploads.
   if(channel.enabled)await publishing.saveChannel({...channel,enabled:false});
   return {ok:true};
  }
  const entry=ACCOUNT_ENTRIES.find(e=>e.id===id);if(!entry)throw new Error("Unknown account entry");
  for(const f of entry.fields)await this.secrets().delete(f.key).catch(()=>{});
  if(id==="telegram-bot")await this.store.updateSettings(st=>({...st,telegram:{...st.telegram,enabled:false}}),"studio-ui");
  return {ok:true};
 }
 async saveChannelCredentials(channelId:string,credentials:unknown){
  const publishing=new StudioPublishingStore(this.store),channel=await publishing.channel(channelId);if(!channel)throw new Error("Channel not found");
  return publishing.saveChannel({...channel},credentials);
 }
 async saveTelegramPolicy(input:unknown){
  const v=z.object({enabled:z.boolean(),chatIds:z.string().max(2000),userIds:z.string().max(2000)}).parse(input);
  const ids=(s:string)=>s.split(/[\s,]+/).map(x=>x.trim()).filter(Boolean).map(x=>{if(!/^-?\d{1,20}$/.test(x))throw new Error("Telegram IDs must be numbers");return x;});
  const chats=ids(v.chatIds),users=ids(v.userIds);
  if(v.enabled&&(!users.length||!await this.secrets().has("telegram.botToken")))throw new Error("Enable Telegram only with a bot token and at least one allowed user ID");
  await this.store.updateSettings(st=>({...st,telegram:{...st.telegram,enabled:v.enabled,allowedChatIds:chats,allowedUserIds:users}}),"studio-ui");
  await this.store.audit({actor:"studio-ui",action:"accounts.telegram-policy",subject:"telegram",detail:{enabled:v.enabled,chats:chats.length,users:users.length}});
  return {ok:true};
 }
 /** Read-only identity checks. No message is sent and nothing is posted. */
 async test(id:string){
  const entry=ACCOUNT_ENTRIES.find(e=>e.id===id);if(!entry||!entry.test)throw new Error("This entry has no connection test");
  const keys=entry.fields.map(f=>f.key),vals=await this.values(keys);if(vals.some(v=>!v))throw new Error("Save every value of this entry first");
  const secretVals=vals.filter((v):v is string=>!!v);
  const f=this.fetchImpl;let row:Omit<z.infer<typeof AccountStatusRow>,"fingerprint"|"checkedAt">;
  try{
   switch(entry.test){
    case "telegram-bot":{const r=await f(`https://api.telegram.org/bot${vals[0]}/getMe`);const j:any=await r.json().catch(()=>({}));row=j?.ok?{state:"verified",detail:"getMe OK",accountName:j.result?.username?`@${j.result.username}`:null,expiresAt:null}:{state:r.status===401?"expired":"failed",detail:`Telegram ${r.status}: ${j?.description??""}`,accountName:null,expiresAt:null};break;}
    case "youtube-client":{
     // A deliberately invalid authorization code: Google answers invalid_grant for a valid client and invalid_client otherwise.
     const r=await f("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:vals[0]!,client_secret:vals[1]!,code:"acs-connection-test",grant_type:"authorization_code",redirect_uri:"http://127.0.0.1"})});
     const j:any=await r.json().catch(()=>({}));row=j?.error==="invalid_grant"?{state:"verified",detail:"OAuth client accepted (test code rejected as expected)",accountName:null,expiresAt:null}:{state:"failed",detail:`Google: ${j?.error??r.status} ${j?.error_description??""}`,accountName:null,expiresAt:null};break;}
    case "youtube-refresh":{
     const [clientId,clientSecret]=await this.values(["youtube.clientId","youtube.clientSecret"]);if(!clientId||!clientSecret)throw new Error("Save the YouTube OAuth app first");
     const r=await f("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:vals[0]!,grant_type:"refresh_token"})});
     const j:any=await r.json().catch(()=>({}));row=j?.access_token?{state:"verified",detail:`Token refreshed; scope ${String(j.scope??"").slice(0,200)}`,accountName:null,expiresAt:null}:{state:j?.error==="invalid_grant"?"expired":"failed",detail:`Google: ${j?.error??r.status}`,accountName:null,expiresAt:null};break;}
    case "meta-token":{
     const r=await f(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(vals[0]!)}`);const j:any=await r.json().catch(()=>({}));
     if(!r.ok||j?.error){row={state:Number(j?.error?.code)===190?"expired":"failed",detail:`Meta: ${j?.error?.message??r.status}`,accountName:null,expiresAt:null};break;}
     let expiresAt:string|null=null,detail=`Token belongs to ${j.name??j.id}`;const [appId,appSecret]=await this.values(["meta.appId","meta.appSecret"]);
     if(appId&&appSecret){const d=await f(`https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(vals[0]!)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`);const dj:any=await d.json().catch(()=>({}));const data=dj?.data;if(data){if(data.is_valid===false){row={state:"expired",detail:"Meta debug_token: token is not valid",accountName:j.name??null,expiresAt:null};break;}if(Number(data.expires_at)>0)expiresAt=new Date(Number(data.expires_at)*1000).toISOString();detail+=`; scopes ${(data.scopes??[]).join(", ").slice(0,200)}`;}}
     else detail+="; add the Meta app to also check expiry and scopes";
     row={state:"verified",detail,accountName:j.name??String(j.id),expiresAt};break;}
    case "tiktok-token":{
     const r=await f("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",{headers:{authorization:`Bearer ${vals[0]}`}});const j:any=await r.json().catch(()=>({}));
     row=r.ok&&(!j?.error?.code||j.error.code==="ok")?{state:"verified",detail:"user/info OK",accountName:j?.data?.user?.display_name??null,expiresAt:null}:{state:r.status===401||j?.error?.code==="access_token_invalid"?"expired":"failed",detail:`TikTok: ${j?.error?.code??r.status}`,accountName:null,expiresAt:null};break;}
   }
  }catch(error){row={state:"failed",detail:error instanceof Error?error.message:"Connection test failed",accountName:null,expiresAt:null};}
  row={...row!,detail:redact(row!.detail,secretVals)};
  await this.record(id,keys,row);return row;
 }
}
