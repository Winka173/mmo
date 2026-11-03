"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {runStateLabel} from "./labels";

const KIND:Record<string,[string,string]>={text:["Chữ","Text"],link:["Link","Link"],image:["Một ảnh","Single image"],carousel:["Nhiều ảnh / carousel","Multiple images / carousel"]};
const SUPPORT:Record<string,string[]>={facebook_reels:["text","link","image","carousel"],instagram_reels:["image","carousel"],tiktok:["image","carousel"],youtube_long:[],youtube_shorts:[]};
const PL:Record<string,string>={facebook_reels:"Facebook Page",instagram_reels:"Instagram",tiktok:"TikTok",youtube_long:"YouTube",youtube_shorts:"YouTube"};

/** Text, link, image and carousel posts: create → two reviews → authorization per channel → publish → reconcile → metrics, or manual export. */
export function StudioPosts({en}:{en:boolean}){
 const t=(vi:string,eng:string)=>en?eng:vi,[data,setData]=useState<any>(null),[kind,setKind]=useState("image"),[note,setNote]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const load=()=>fetch("/api/studio/posts",{cache:"no-store"}).then(r=>r.json()).then(setData);
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),6000);return()=>clearInterval(timer);},[]);
 async function send(body:any,done:string){setBusy(true);setError("");setNote("");try{const r=await fetch("/api/studio/posts",body instanceof FormData?{method:"POST",body}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),j=await r.json();if(!r.ok)throw new Error(j.error);setNote(done);await load();return j;}catch(e:any){setError(e.message);return null;}finally{setBusy(false);}}
 return <>
  <form className="acs-panel" aria-label={t("Tạo bài viết","New post")} onSubmit={e=>{e.preventDefault();const form=e.currentTarget;void send(new FormData(form),t("Đã tạo bài; hãy duyệt hai phạm vi bên dưới","Post created; review both scopes below")).then(ok=>{if(ok)form.reset();});}}>
   <h2>{t("Bài viết, link và ảnh","Text, link and image posts")}</h2>
   <p className="acs-muted">{t("Facebook Page: chữ, link, một ảnh, nhiều ảnh · Instagram: một ảnh, carousel · TikTok: bài ảnh/carousel · YouTube: bài cộng đồng không có API chính thức → dùng gói xuất thủ công. Mọi đường đăng đều chờ tài khoản.","Facebook Page: text, link, single image, multiple images · Instagram: single image, carousel · TikTok: photo/carousel posts · YouTube: community posts have no official API → use the manual export package. Every posting path needs an account.")}</p>
   <div className="acs-form-grid"><label className="acs-field">{t("Tên bài (nội bộ)","Post name (internal)")}<input name="title" required maxLength={160}/></label>
   <label className="acs-field">{t("Loại bài","Post type")}<select name="kind" value={kind} onChange={e=>setKind(e.target.value)}>{Object.keys(KIND).map(k=><option key={k} value={k}>{KIND[k][en?1:0]}</option>)}</select></label>
   {kind==="link"&&<label className="acs-field">URL<input name="link" type="url" required/></label>}
   {["image","carousel"].includes(kind)&&<label className="acs-field">{kind==="image"?t("Ảnh (1)","Image (1)"):t("Ảnh (2–10)","Images (2–10)")}<input name="images" type="file" accept="image/png,image/jpeg,image/webp" multiple={kind==="carousel"} required/></label>}</div>
   <label className="acs-field">{t("Nội dung / chú thích","Text / caption")}<textarea name="text" rows={3} maxLength={5000} required={kind==="text"}/></label>
   <label className="acs-check"><input type="checkbox" name="aiGenerated"/>{t("Có nội dung do AI tạo (gắn nhãn AI khi đăng)","Contains AI-generated content (labelled when posted)")}</label>
   <button className="acs-primary" disabled={busy}>{t("Tạo bài","Create post")}</button>
  </form>
  {error&&<p role="alert" className="acs-alert error">{error}</p>}{note&&<p role="status" className="acs-alert">{note}</p>}
  {(data?.posts??[]).map((p:any)=><article key={p.id} className="acs-panel" data-post={p.id} aria-label={p.title}>
   <header><h3>{p.title}</h3><span className="acs-badge">{KIND[p.kind][en?1:0]} · {p.approved?t("Đã duyệt","Approved"):t("Chờ duyệt","Needs review")}</span></header>
   <p>{p.text}{p.link&&<> · <a href={p.link} target="_blank" rel="noreferrer">{p.link}</a></>}</p>{p.images.length>0&&<p className="acs-muted">{p.images.length} {t("ảnh","images")}</p>}
   {!p.approved&&<PostReview p={p} en={en} busy={busy} send={send}/>}
   {p.approved&&<form className="acs-actions" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void send({action:"request",id:p.id,channelId:f.get("channel"),privacy:f.get("privacy"),authorize:true},t("Đã xếp hàng đăng (chờ tài khoản nếu chưa nhập khóa)","Queued for posting (needs account if no key is saved)"));}}>
    <label className="acs-field">{t("Kênh","Channel")}<select name="channel" required>{(data.channels??[]).map((c:any)=><option key={c.id} value={c.id} disabled={!c.enabled||!SUPPORT[c.platform]?.includes(p.kind)}>{c.name} · {PL[c.platform]}{!SUPPORT[c.platform]?.includes(p.kind)?t(" — không có API cho loại bài này"," — no API for this post type"):!c.enabled?t(" — kênh đang tắt"," — channel disabled"):""}</option>)}</select></label>
    <label className="acs-field">{t("Hiển thị","Visibility")}<select name="privacy"><option value="public">{t("Công khai","Public")}</option><option value="private">{t("Riêng tư / nháp","Private / draft")}</option></select></label>
    <label className="acs-check"><input type="checkbox" required/>{t("Tôi cho phép đăng đúng bài này lên kênh đã chọn.","I authorize posting this exact post to the selected channel.")}</label><button disabled={busy}>{t("Xếp hàng đăng","Queue post")}</button></form>}
   {p.publications.map((x:any)=><p key={x.channelId} className="acs-muted">{PL[x.platform]} · {runStateLabel(x.state,en)}{x.url&&<> · <a href={x.url} target="_blank" rel="noreferrer">{t("mở bài","open post")}</a></>}{x.metrics&&<> · {Object.entries(x.metrics).filter(([,v])=>v!=null).map(([k,v])=>`${k} ${v}`).join(", ")}</>}{x.error&&<> · {x.error}</>}{x.remoteId&&<> <button type="button" onClick={()=>void send({action:"check",id:p.id,channelId:x.channelId},t("Đã xếp hàng lấy số liệu","Metrics check queued"))}>{t("Lấy số liệu","Fetch metrics")}</button></>}</p>)}
   <a className="acs-link-button" href={`/api/studio/posts/export?id=${p.id}`}>{t("↓ Gói đăng thủ công (dùng cho YouTube cộng đồng)","↓ Manual posting package (use for YouTube community)")}</a>
  </article>)}
  {data&&!data.posts.length&&<section className="acs-panel"><p>{t("Chưa có bài nào.","No posts yet.")}</p></section>}
 </>;
}
function PostReview({p,en,busy,send}:{p:any;en:boolean;busy:boolean;send:(b:any,d:string)=>Promise<any>}){
 const t=(vi:string,eng:string)=>en?eng:vi,[evidence,setEvidence]=useState("");
 const last=(c:string)=>p.decisions.filter((d:any)=>d.category===c&&d.fingerprint===p.fingerprint).at(-1)?.decision;
 return <div className="acs-actions"><label className="acs-field">{t("Ghi chú duyệt (đã kiểm tra gì)","Review note (what you checked)")}<input value={evidence} onChange={e=>setEvidence(e.target.value)} minLength={12}/></label>
  {(["editorial","rights"] as const).map(c=><button key={c} type="button" disabled={busy||evidence.trim().length<12||last(c)==="APPROVED"} onClick={()=>void send({action:"decide",id:p.id,category:c,decision:"APPROVED",fingerprint:p.fingerprint,evidence},t("Đã ghi duyệt","Review recorded"))}>{c==="editorial"?t("Duyệt nội dung","Approve content"):t("Duyệt quyền ảnh/chữ","Approve rights")}{last(c)==="APPROVED"?" ✓":""}</button>)}</div>;
}

/** Facebook Page inbox and comments: read, edit the assistant's draft, approve before anything is sent. */
export function PageInbox({en}:{en:boolean}){
 const t=(vi:string,eng:string)=>en?eng:vi,[items,setItems]=useState<any[]>([]),[channels,setChannels]=useState<any[]>([]),[drafts,setDrafts]=useState<Record<string,string>>({}),[note,setNote]=useState("");
 const load=async()=>{setItems((await fetch("/api/studio/inbox",{cache:"no-store"}).then(r=>r.json())).items);setChannels((await fetch("/api/studio/posts",{cache:"no-store"}).then(r=>r.json())).channels.filter((c:any)=>c.platform==="facebook_reels"));};
 useEffect(()=>{void load();},[]);
 const post=async(body:any,done:string)=>{const r=await fetch("/api/studio/inbox",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),j=await r.json();setNote(r.ok?done:j.error);await load();};
 const CLS:Record<string,[string,string]>={question:["Câu hỏi","Question"],praise:["Khen","Praise"],spam:["Spam","Spam"],harassment:["Quấy rối","Harassment"],product_issue:["Lỗi sản phẩm","Product issue"],support:["Hỗ trợ","Support"],privacy:["Riêng tư","Privacy"],legal:["Pháp lý","Legal"],other:["Khác","Other"]};
 return <section className="acs-panel" aria-label={t("Hộp thư & bình luận Page","Page inbox & comments")}><h2>{t("Hộp thư & bình luận Facebook Page","Facebook Page inbox & comments")}</h2>
  <p className="acs-muted">{t("Đọc tin nhắn và bình luận; nội dung người khác viết chỉ là dữ liệu (lệnh chèn bị gắn cờ). Bản trả lời nháp từ trợ lý; bạn sửa và duyệt từng câu trước khi gửi. Chờ tài khoản: cần Page token trong Tài khoản & Khóa.","Reads messages and comments; what others write is only data (injected instructions are flagged). The assistant drafts a reply; you edit and approve each one before it is sent. Needs account: a Page token in Accounts & Keys.")}</p>
  <div className="acs-actions">{channels.map(c=><button key={c.id} type="button" onClick={()=>void post({action:"sync",channelId:c.id},t("Đã xếp hàng đồng bộ","Sync queued"))}>{t("Đồng bộ","Sync")} {c.name}</button>)}{!channels.length&&<span>{t("Thêm kênh Facebook Page ở trang Kênh trước.","Add a Facebook Page channel on the Channels page first.")} <Link href="/studio/channels">{t("Kênh →","Channels →")}</Link></span>}</div>
  {note&&<p role="status">{note}</p>}
  {items.map(i=><article key={i.id} className="acs-panel" data-inbox={i.id}><header><b>{i.author||i.authorId}</b><span className="acs-badge">{i.kind==="comment"?t("Bình luận","Comment"):t("Tin nhắn","Message")} · {CLS[i.class]?.[en?1:0]??i.class}{i.injectionSuspected?t(" · có lệnh chèn"," · injection flagged"):""}{i.escalate?t(" · cần bạn xử lý"," · needs you"):""}</span></header>
   <p>{i.sanitized}</p>
   {["new","failed"].includes(i.state)?<div className="acs-actions"><label className="acs-field">{t("Trả lời (bạn duyệt trước khi gửi)","Reply (you approve before sending)")}<textarea rows={2} maxLength={2000} value={drafts[i.id]??i.draft} onChange={e=>setDrafts({...drafts,[i.id]:e.target.value})}/></label><button type="button" className="acs-primary" disabled={!(drafts[i.id]??i.draft).trim()} onClick={()=>void post({action:"approve",id:i.id,text:drafts[i.id]??i.draft},t("Đã duyệt; worker sẽ gửi","Approved; the worker will send it"))}>{t("Duyệt & gửi","Approve & send")}</button><button type="button" onClick={()=>void post({action:"dismiss",id:i.id},t("Đã bỏ qua","Dismissed"))}>{t("Bỏ qua","Dismiss")}</button></div>:<p className="acs-muted">{({approved:t("Đã duyệt, chờ gửi","Approved, waiting to send"),sending:t("Đang gửi","Sending"),sent:t("Đã gửi","Sent"),dismissed:t("Đã bỏ qua","Dismissed")} as any)[i.state]}{i.error?` · ${i.error}`:""}</p>}
  </article>)}
  {!items.length&&<p>{t("Chưa có tin nhắn hay bình luận nào được đồng bộ.","No messages or comments synced yet.")}</p>}
 </section>;
}
