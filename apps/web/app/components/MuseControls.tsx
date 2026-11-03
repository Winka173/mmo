"use client";
import {useEffect,useState} from "react";
import type {Autopilot} from "@ttm/automation";

const STATUS:Record<string,[string,string]>={terms:["Chưa xác nhận thông báo","Notice not acknowledged"],disabled:["Đang tắt","Off"],needs_login:["Chờ đăng nhập","Needs login"],owner_reported_logged_in:["Bạn báo đã đăng nhập (chưa kiểm chứng)","You reported a login (not verified)"]};

/** Settings › Accounts & Keys entry for Meta AI / Muse: notice, enable, pacing and cap, manual login window. */
export function MuseAccount({en}:{en:boolean}){
 const t=(vi:string,eng:string)=>en?eng:vi,[d,setD]=useState<any>(null),[note,setNote]=useState("");
 const load=()=>fetch("/api/studio/muse",{cache:"no-store"}).then(r=>r.json()).then(setD);useEffect(()=>{void load();},[]);
 const post=async(body:any,done:string)=>{const r=await fetch("/api/studio/muse",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),j=await r.json();setNote(r.ok?done:j.error);await load();};
 if(!d)return null;const s=d.settings;
 return <article className="acs-panel acs-account" data-entry="meta-muse" aria-label="Meta AI / Muse"><header><h3>Meta AI / Muse</h3><span className="acs-badge" data-state={d.status}>{STATUS[d.status]?.[en?1:0]??d.status}</span></header>
  <p className="acs-muted">{t("Dùng cho: tạo video qua Muse AI. Muse chưa có API công khai, nên ACS điều khiển trình duyệt meta.ai bằng tài khoản của bạn (một tài khoản, hồ sơ trình duyệt riêng, nhịp như người, giới hạn mỗi ngày). Gặp captcha/kiểm tra/đăng nhập/giới hạn thì dừng và chờ bạn.","Used by: Generate with Muse AI. Muse has no public API, so ACS drives meta.ai in a browser with your account (one account, its own browser profile, human pacing, a daily cap). On a captcha, checkpoint, login wall or limit it stops and waits for you.")}</p>
  <p className="acs-alert" role="note">{t("Lưu ý: tự động hóa trình duyệt có thể vi phạm điều khoản của Meta; tài khoản có thể bị hạn chế. ACS không giải captcha, không dùng plugin ẩn danh, proxy hay xoay vòng tài khoản.","Notice: browser automation may break Meta's terms; the account may be restricted. ACS never solves captchas and uses no stealth plugins, proxies or account rotation.")}</p>
  <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void post({action:"save",enabled:f.get("enabled")==="on",acknowledge:f.get("ack")==="on",dailyCap:Number(f.get("cap")),minDelayMs:Number(f.get("min"))*1000,maxDelayMs:Number(f.get("max"))*1000},t("Đã lưu","Saved"));}}>
   <label className="acs-check"><input type="checkbox" name="ack" defaultChecked={!!s.termsAcknowledgedAt} disabled={!!s.termsAcknowledgedAt}/>{t("Tôi đã đọc lưu ý trên và tự chịu trách nhiệm cho tài khoản của mình.","I read the notice above and take responsibility for my account.")}</label>
   <label className="acs-check"><input type="checkbox" name="enabled" defaultChecked={s.enabled}/>{t("Bật Muse","Enable Muse")}</label>
   <div className="acs-form-grid"><label className="acs-field">{t("Số video tối đa mỗi ngày","Videos per day (max)")}<input name="cap" type="number" min={0} max={50} defaultValue={s.dailyCap}/></label><label className="acs-field">{t("Nghỉ tối thiểu giữa thao tác (giây)","Minimum pause between steps (s)")}<input name="min" type="number" min={0.2} step={0.1} defaultValue={s.minDelayMs/1000}/></label><label className="acs-field">{t("Nghỉ tối đa (giây)","Maximum pause (s)")}<input name="max" type="number" min={0.3} step={0.1} defaultValue={s.maxDelayMs/1000}/></label></div>
   <div className="acs-actions"><button className="acs-primary">{t("Lưu","Save")}</button><button type="button" disabled={!s.enabled||!s.termsAcknowledgedAt} onClick={()=>void post({action:"open-login"},t("Đã mở cửa sổ đăng nhập; hãy đăng nhập meta.ai bằng tay rồi đóng cửa sổ.","Login window opened; log in to meta.ai by hand, then close it."))}>{t("Mở cửa sổ đăng nhập","Open login window")}</button><button type="button" disabled={!s.enabled} onClick={()=>void post({action:"logged-in"},t("Đã ghi nhận","Noted"))}>{t("Tôi đã đăng nhập xong","I have logged in")}</button></div>
  </form>
  <p className="acs-muted">{t("Hôm nay đã dùng","Used today")}: {d.usedToday}/{s.dailyCap} · {t("Giới hạn thời lượng/khung hình của Muse: CHƯA KIỂM CHỨNG","Muse duration/aspect limits: UNVERIFIED")}</p>{note&&<p role="status">{note}</p>}
 </article>;
}

/** Create / Autopilot: choose the ACS pipeline or "Generate with Muse AI"; prompts written by the local LLM and edited by the owner. */
export function MuseControls({draft,update,en}:{draft:Partial<Autopilot>;update:(v:Partial<Autopilot>)=>void;en:boolean}){
 const t=(vi:string,eng:string)=>en?eng:vi,mode=draft.generation??"pipeline",prompts=draft.musePrompts??[],overlay=draft.museOverlay??{captions:false,logo:false},[note,setNote]=useState("");
 async function writePrompts(){if(!draft.id){setNote(t("Lưu bản nháp trước (bấm Tiếp tục).","Save the draft first (press Continue)."));return;}const r=await fetch("/api/studio",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"muse-prompts",id:draft.id})}),j=await r.json();setNote(r.ok?t("Đã xếp hàng: AI local đang viết prompt; mở lại bản nháp sau ít phút để xem và sửa.","Queued: the local AI is writing prompts; reopen the draft in a few minutes to review and edit them."):j.error);}
 return <section className="acs-panel" aria-label={t("Nguồn video","Video source")}><h3>{t("Nguồn video","Video source")}</h3>
  <div className="acs-actions" role="radiogroup"><label className="acs-check"><input type="radio" name="generation" checked={mode==="pipeline"} onChange={()=>update({generation:"pipeline"})}/>{t("Quy trình ACS (kịch bản, giọng, dựng)","ACS pipeline (script, voice, render)")}</label><label className="acs-check"><input type="radio" name="generation" checked={mode==="muse"} onChange={()=>update({generation:"muse"})}/>{t("Tạo qua Muse AI","Generate with Muse AI")}</label></div>
  {mode==="muse"&&<><p className="acs-muted">{t("Muse tạo video hoàn chỉnh kèm âm thanh. ACS không sửa video (mặc định), chỉ kiểm tra kỹ thuật, duyệt, lên lịch và đăng; nhãn “do AI tạo” được gắn tự động. Cần đăng nhập Meta AI trong Cài đặt › Tài khoản & Khóa (chờ đăng nhập).","Muse makes the finished video with its own audio. ACS does not edit it (default); it only checks, reviews, schedules and publishes it, with the AI-generated label added automatically. Needs a Meta AI login in Settings › Accounts & Keys (needs login).")}</p>
   {prompts.map((p,i)=><label key={i} className="acs-field">{t("Prompt Muse","Muse prompt")} {i+1}<textarea rows={3} value={p} maxLength={2000} onChange={e=>update({musePrompts:prompts.map((x,k)=>k===i?e.target.value:x)})}/></label>)}
   <div className="acs-actions"><button type="button" onClick={()=>void writePrompts()}>{t("Viết prompt bằng AI local","Write prompts with local AI")}</button><button type="button" disabled={prompts.length>=4} onClick={()=>update({musePrompts:[...prompts,""]})}>{t("+ Prompt tự viết","+ Own prompt")}</button></div>
   <label className="acs-check"><input type="checkbox" checked={overlay.logo} onChange={e=>update({museOverlay:{...overlay,logo:e.target.checked}})}/>{t("Thêm tên thương hiệu góc trên (tắt mặc định)","Add the brand name in a corner (off by default)")}</label>
   <label className="acs-check"><input type="checkbox" checked={false} disabled/>{t("Phụ đề cho video Muse: chưa hỗ trợ","Captions on Muse videos: not supported yet")}</label>{note&&<p role="status">{note}</p>}</>}
 </section>;
}
