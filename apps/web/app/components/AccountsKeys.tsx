"use client";
import {useEffect,useState} from "react";
import YouTubeOAuth from "./YouTubeOAuth";
import {shortTime} from "./labels";

type Field={key:string;vi:string;en:string;secret?:boolean;present?:boolean;value?:string|null};
type Entry={id:string;group:string;vi:string;en:string;fields:Field[];usedBy:{vi:string;en:string}[];test:string|null;state:string;checkedAt:string|null;detail:string|null;accountName:string|null;expiresAt:string|null};
type ChannelRow={id:string;name:string;platform:string;expectedRemoteId:string;enabled:boolean;revision:number;fields:Field[];present:boolean;state:string;checkedAt:string|null;detail:string|null;accountName:string|null};
type Overview={backend:string;entries:Entry[];channels:ChannelRow[];unused:string[];telegram:{enabled:boolean;allowedChatIds:string[];allowedUserIds:string[]}};

const STATE:Record<string,[string,string]>={not_set:["Chờ tài khoản","Needs account"],partial:["Thiếu một phần","Incomplete"],set:["Đã lưu, chưa kiểm tra","Saved, not tested"],verified:["Đã xác minh","Verified"],expired:["Hết hạn / bị thu hồi","Expired / revoked"],failed:["Kiểm tra lỗi","Check failed"]};
const PLATFORM:Record<string,string>={youtube_long:"YouTube video",youtube_shorts:"YouTube Shorts",facebook_reels:"Facebook Page Reels",instagram_reels:"Instagram Reels",tiktok:"TikTok"};
const GROUPS:[string,string,string][]=[["youtube","YouTube","YouTube"],["meta","Facebook & Instagram (Meta)","Facebook & Instagram (Meta)"],["tiktok","TikTok","TikTok"],["telegram","Telegram","Telegram"]];

/** Settings › Accounts & Keys: the one place where credentials are entered. Values are write-only. */
export default function AccountsKeys({en}:{en:boolean}){
 const t=(vi:string,eng:string)=>en?eng:vi;
 const [data,setData]=useState<Overview|null>(null),[busy,setBusy]=useState(""),[notice,setNotice]=useState(""),[error,setError]=useState("");
 async function load(){const r=await fetch("/api/studio/accounts",{cache:"no-store"});if(!r.ok)throw new Error(`HTTP ${r.status}`);setData(await r.json());}
 useEffect(()=>{void load().catch(e=>setError(e.message));const timer=setInterval(()=>void load().catch(()=>{}),6000);return()=>clearInterval(timer);},[]);
 async function post(body:Record<string,unknown>,key:string,done:string){setBusy(key);setError("");setNotice("");try{const r=await fetch("/api/studio/accounts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error);setNotice(done);await load();return j;}catch(e:any){setError(e.message);return null;}finally{setBusy("");}}
 const badge=(state:string)=><span className={`acs-badge acs-account-${state}`} data-state={state}>{STATE[state]?.[en?1:0]??state}</span>;
 const values=(form:HTMLFormElement)=>Object.fromEntries([...new FormData(form).entries()].map(([k,v])=>[k,String(v)]).filter(([,v])=>v.trim()));
 if(!data)return <section className="acs-panel" aria-label={t("Tài khoản & Khóa","Accounts & Keys")}><h2>{t("Tài khoản & Khóa","Accounts & Keys")}</h2><p>{error||t("Đang tải…","Loading…")}</p></section>;
 const entryCard=(e:Entry)=><article key={e.id} className="acs-panel acs-account" aria-label={en?e.en:e.vi} data-entry={e.id}>
  <header><h3>{en?e.en:e.vi}</h3>{badge(e.state)}</header>
  <p className="acs-muted">{t("Dùng cho","Used by")}: {e.usedBy.map(u=>en?u.en:u.vi).join(" · ")}</p>
  {e.checkedAt&&<p className="acs-muted">{t("Kiểm tra lúc","Checked")} {shortTime(e.checkedAt,en)}{e.accountName?` · ${e.accountName}`:""}{e.expiresAt?` · ${t("hết hạn","expires")} ${shortTime(e.expiresAt,en)}`:""}{e.detail?` · ${e.detail}`:""}</p>}
  <form onSubmit={ev=>{ev.preventDefault();const form=ev.currentTarget;void post({action:"save",id:e.id,values:values(form)},`save-${e.id}`,t("Đã lưu (mã hóa DPAPI)","Saved (DPAPI encrypted)")).then(ok=>{if(ok)form.reset();});}}>
   <div className="acs-form-grid">{e.fields.map(f=><label key={f.key} className="acs-field">{en?f.en:f.vi}<input name={f.key} type={f.secret?"password":"text"} autoComplete="off" spellCheck={false} placeholder={f.present?(f.secret?t("•••••• đã lưu — nhập để thay","•••••• saved — type to replace"):(f.value??"")):""}/></label>)}</div>
   <div className="acs-actions"><button className="acs-primary" disabled={!!busy}>{t("Lưu","Save")}</button>
    {e.test&&<button type="button" disabled={!!busy||e.state==="not_set"||e.state==="partial"} onClick={()=>void post({action:"test",id:e.id},`test-${e.id}`,t("Đã kiểm tra kết nối","Connection checked"))}>{busy===`test-${e.id}`?t("Đang kiểm tra…","Checking…"):t("Kiểm tra kết nối","Test connection")}</button>}
    <button type="button" disabled={!!busy||e.state==="not_set"} onClick={()=>{if(confirm(t("Xóa khóa này khỏi máy? Tính năng dùng nó sẽ dừng.","Remove this key from this PC? Features that use it will stop.")))void post({action:"remove",id:e.id},`remove-${e.id}`,t("Đã xóa","Removed"));}}>{t("Xóa","Remove")}</button></div>
  </form>
 </article>;
 return <section className="acs-panel" aria-label={t("Tài khoản & Khóa","Accounts & Keys")} id="accounts">
  <h2>{t("Tài khoản & Khóa","Accounts & Keys")}</h2>
  <p>{t("Mọi tài khoản và khóa app dùng đều nhập tại đây. Giá trị được mã hóa bằng Windows DPAPI và không bao giờ hiển thị lại; muốn đổi thì nhập giá trị mới. “Kiểm tra kết nối” chỉ đọc danh tính tài khoản, không đăng bài và không gửi tin nhắn.","Every account and key the app uses is entered here. Values are encrypted with Windows DPAPI and never shown again; type a new value to replace one. “Test connection” only reads the account identity; it never posts or sends a message.")}</p>
  {error&&<p role="alert" className="acs-alert error">{error}</p>}{notice&&<p role="status" className="acs-alert">{notice}</p>}
  {GROUPS.map(([group,vi,eng])=><section key={group} className="acs-account-group" aria-label={en?eng:vi}><h3>{en?eng:vi}</h3>
   {data.entries.filter(e=>e.group===group).map(entryCard)}
   {group==="telegram"&&<form className="acs-panel" aria-label={t("Quyền dùng bot","Bot access policy")} onSubmit={ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget);void post({action:"telegram",enabled:f.get("enabled")==="on",chatIds:String(f.get("chats")??""),userIds:String(f.get("users")??"")},"telegram",t("Đã lưu quyền Telegram","Telegram access saved"));}}>
    <h3>{t("Quyền dùng bot","Bot access policy")}</h3>
    <label className="acs-check"><input type="checkbox" name="enabled" defaultChecked={data.telegram.enabled}/>{t("Bật Telegram (cần bot token và ít nhất một User ID)","Enable Telegram (needs the bot token and at least one user ID)")}</label>
    <div className="acs-form-grid"><label className="acs-field">{t("Chat ID được phép","Allowed chat IDs")}<input name="chats" defaultValue={data.telegram.allowedChatIds.join(", ")}/></label><label className="acs-field">{t("User ID được phép","Allowed user IDs")}<input name="users" defaultValue={data.telegram.allowedUserIds.join(", ")}/></label></div>
    <button disabled={!!busy}>{t("Lưu quyền","Save access")}</button></form>}
   {group!=="telegram"&&data.channels.filter(c=>group==="youtube"?c.platform.startsWith("youtube"):group==="meta"?["facebook_reels","instagram_reels"].includes(c.platform):c.platform==="tiktok").map(c=><article key={c.id} className="acs-panel acs-account" aria-label={`${PLATFORM[c.platform]} ${c.name}`} data-channel={c.id}>
    <header><h3>{t("Kênh","Channel")}: {c.name}</h3>{badge(c.state)}</header>
    <p className="acs-muted">{PLATFORM[c.platform]} · {c.expectedRemoteId} · {c.enabled?t("đang bật","enabled"):t("đang tắt","disabled")} · {t("Dùng cho: đăng phiên bản đã duyệt lên kênh này","Used by: uploading reviewed versions to this channel")}</p>
    {c.checkedAt&&<p className="acs-muted">{t("Kiểm tra lúc","Checked")} {shortTime(c.checkedAt,en)}{c.accountName?` · ${c.accountName}`:""}{c.detail?` · ${c.detail}`:""}</p>}
    <form onSubmit={ev=>{ev.preventDefault();const form=ev.currentTarget;void post({action:"channel-credentials",channelId:c.id,values:values(form)},`ch-${c.id}`,t("Đã lưu thông tin kênh (mã hóa)","Channel credentials saved (encrypted)")).then(ok=>{if(ok)form.reset();});}}>
     <div className="acs-form-grid">{c.fields.map(f=><label key={f.key} className="acs-field">{en?f.en:f.vi}<input name={f.key} type="password" autoComplete="off" required={!c.present} placeholder={c.present?t("•••••• đã lưu — nhập lại đủ để thay","•••••• saved — enter all to replace"):""}/></label>)}</div>
     <div className="acs-actions"><button className="acs-primary" disabled={!!busy}>{t("Lưu","Save")}</button>
      <button type="button" disabled={!!busy||!c.present} onClick={()=>void post({action:"channel-test",channelId:c.id},`cht-${c.id}`,t("Đã xếp hàng kiểm tra kênh; kết quả hiện ở đây khi worker chạy xong.","Channel check queued; the result appears here when the worker finishes."))}>{t("Kiểm tra kết nối","Test connection")}</button>
      <button type="button" disabled={!!busy||!c.present} onClick={()=>{if(confirm(t("Xóa thông tin đăng nhập của kênh này? Kênh sẽ bị tắt; vẫn có thể xuất gói đăng thủ công.","Remove this channel's credentials? The channel is disabled; manual export still works.")))void post({action:"remove",id:`channel:${c.id}`},`chr-${c.id}`,t("Đã xóa","Removed"));}}>{t("Xóa","Remove")}</button></div>
    </form>
   </article>)}
   {group==="youtube"&&<YouTubeOAuth en={en} channels={data.channels.filter(c=>c.platform.startsWith("youtube")) as any}/>}
  </section>)}
  <section className="acs-account-group" aria-label={t("Affiliate","Affiliate")}><h3>{t("Affiliate","Affiliate")}</h3><article className="acs-panel acs-account" data-entry="affiliate"><header><h3>{t("Mạng affiliate","Affiliate networks")}</h3><span className="acs-badge">{t("Không cần khóa","No key needed")}</span></header><p className="acs-muted">{t("Link affiliate và lời công bố được nhập theo từng sản phẩm trong Autopilot. Hiện không tính năng nào gọi API của mạng affiliate, nên không có khóa nào cần nhập.","Affiliate links and disclosures are entered per product in each Autopilot. No feature calls an affiliate network API today, so there is no key to enter.")}</p></article></section>
  {data.unused.length>0&&<section className="acs-account-group" aria-label={t("Khóa không còn dùng","Keys no longer used")}><h3>{t("Khóa không còn dùng","Keys no longer used")}</h3>{data.unused.map(k=><p key={k}><code>{k}</code> <button type="button" disabled={!!busy} onClick={()=>void post({action:"remove",id:`unused:${k}`},`u-${k}`,t("Đã xóa","Removed"))}>{t("Xóa","Remove")}</button></p>)}</section>}
  <p className="acs-muted">{t("Lưu trữ","Storage")}: {data.backend==="windows-dpapi"?"Windows DPAPI":data.backend}</p>
 </section>;
}
