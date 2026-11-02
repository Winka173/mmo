"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import type {ModelSetup} from "@ttm/automation";

type Cap={id:string;profile:string;vi:string;en:string;hintVi:string;hintEn:string;gib:number;done:(c:Record<string,any>)=>boolean;optional?:boolean};
/** What the owner wants to do, mapped to the setup profiles that provide it. Order matters: the quality text model needs the fast one first. */
const CAPS:Cap[]=[
 {id:"script",profile:"qwen3.5-9b",vi:"Viết kịch bản (nhanh)",en:"Scripts (fast)",hintVi:"Qwen3.5-9B trên GPU: nháp, tiêu đề, caption",hintEn:"Qwen3.5-9B on the GPU: drafts, titles, captions",gib:16,done:c=>!!c.llmModel},
 {id:"quality",profile:"qwen-quality",vi:"Chất lượng cao (kịch bản cuối, dịch, kiểm chứng, đọc ảnh)",en:"High quality (final scripts, translation, fact checks, vision)",hintVi:"Gemma 4 31B chạy CPU, cần ~20 GB RAM trống khi dùng",hintEn:"Gemma 4 31B on the CPU, needs about 20 GB free RAM while used",gib:24,done:c=>!!c.llmQualityModel},
 {id:"vi",profile:"vieneu",vi:"Giọng đọc tiếng Việt",en:"Vietnamese voice",hintVi:"VieNeu-TTS v3 Turbo",hintEn:"VieNeu-TTS v3 Turbo",gib:18,done:c=>!!c.ttsViModel},
 {id:"en",profile:"kokoro",vi:"Giọng đọc tiếng Anh",en:"English voice",hintVi:"Kokoro-82M (US và UK)",hintEn:"Kokoro-82M (US and UK)",gib:10,done:c=>!!c.ttsEnModel},
 {id:"asr",profile:"qwen-asr",vi:"Nhận dạng giọng nói (Việt, Anh, Trung)",en:"Speech recognition (VI, EN, ZH)",hintVi:"Qwen3-ASR-1.7B: kiểm tra lời đọc, phụ đề",hintEn:"Qwen3-ASR-1.7B: narration and caption checks",gib:14,done:c=>!!c.asrModel},
 {id:"vad",profile:"silero-vad",vi:"Phát hiện im lặng",en:"Silence detection",hintVi:"Silero VAD (rất nhỏ)",hintEn:"Silero VAD (tiny)",gib:1,done:c=>!!c.vadModel},
 {id:"search",profile:"qwen-embedding",vi:"Tìm kiếm nội dung",en:"Content search",hintVi:"Qwen3-Embedding-0.6B",hintEn:"Qwen3-Embedding-0.6B",gib:4,done:c=>!!c.embeddingModel},
 {id:"image",profile:"flux2-klein-4b",vi:"Ảnh minh họa",en:"Illustrations",hintVi:"FLUX.2 klein 4B (tuỳ chọn, ~38 GB)",hintEn:"FLUX.2 klein 4B (optional, ~38 GB)",gib:38,done:c=>!!c.imageModel,optional:true},
];
const DEFAULT_SELECTION=CAPS.filter(c=>!c.optional).map(c=>c.id);
const KEY="acs-auto-setup";
const live=(row:ModelSetup)=>["queued","running"].includes(row.state);
const done=(row:ModelSetup)=>["installed","verified"].includes(row.state)&&!!row.resultConfig;

/**
 * One button installs everything the owner ticked: auto folder, preflight and install inside the setup job, then the installed paths are applied.
 * The four manual steps below stay available under "Advanced".
 */
export default function AutoModelSetup({en,busy,rows,config,defaultRoot,call}:{en:boolean;busy:boolean;rows:ModelSetup[];config:Record<string,any>;defaultRoot:string;call:(body:Record<string,unknown>)=>Promise<any>}){
 const t=(vi:string,eng:string)=>en?eng:vi;
 const [picked,setPicked]=useState<string[]>(DEFAULT_SELECTION),[active,setActive]=useState(false),[root,setRoot]=useState(""),[note,setNote]=useState("");
 const started=useRef(0),sent=useRef<Record<string,string>>({}),applied=useRef<Record<string,string>>({});
 useEffect(()=>{try{const s=JSON.parse(localStorage.getItem(KEY)??"null");if(Array.isArray(s?.picked))setPicked(s.picked);const m=JSON.parse(localStorage.getItem("acs-model-setup")??"null");if(m?.root)setRoot(m.root);}catch{}},[]);
 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify({picked}));}catch{}},[picked]);
 const folder=root||defaultRoot;
 const norm=(v:string)=>v.trim().replaceAll("/","\\").replace(/\\+$/,"").toLowerCase();
 const mine=useMemo(()=>rows.filter(r=>r.mode==="install"&&norm(r.root)===norm(folder)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),[rows,folder]);
 const latest=(profile:string)=>mine.find(r=>r.profile===profile);
 const wanted=CAPS.filter(c=>picked.includes(c.id));
 const missing=wanted.filter(c=>!c.done(config));
 const totalGib=missing.reduce((s,c)=>s+c.gib,0);
 // Sequential driver: one profile at a time, then apply its result. Idempotent per profile and per start.
 useEffect(()=>{
  if(!active||busy||!folder)return;
  const next=wanted.find(c=>!c.done(config));
  if(!next){setActive(false);setNote(t("Đã cài và áp dụng xong các mục đã chọn.","Everything you ticked is installed and applied."));return;}
  const row=latest(next.profile);
  if(row&&row.createdAt>=new Date(started.current).toISOString()){
   if(live(row))return;
   if(row.state==="failed"){setActive(false);setNote(`${t(next.vi,next.en)}: ${row.error??t("lỗi cài đặt","install failed")}`);return;}
   if(done(row)&&applied.current[next.profile]!==row.id){applied.current[next.profile]=row.id;void call({action:"apply-setup",id:row.id}).catch(()=>{});return;}
   return;
  }
  if(sent.current[next.profile]===String(started.current))return;
  sent.current[next.profile]=String(started.current);
  void call({action:"setup-model",profile:next.profile,root:folder,mode:"install"}).catch(()=>setActive(false));
 },[active,busy,rows,config,folder,picked]);
 function start(){started.current=Date.now()-2000;sent.current={};applied.current={};setNote("");setActive(true);}
 const total=wanted.length,finished=wanted.filter(c=>c.done(config)).length;
 return <section className="acs-panel" aria-label={t("Cài đặt AI tự động","Automatic AI setup")}>
  <h2>{t("Cài đặt AI tự động","Automatic AI setup")}</h2>
  <p>{t("Tick những gì bạn cần rồi bấm một nút. ACS tự chọn thư mục, kiểm tra máy, tải model, áp dụng đường dẫn và báo tiến trình. Tải dở được tiếp tục, không phải nhập gì thêm.","Tick what you need and press one button. ACS picks the folder, checks the machine, downloads the models, applies the paths and shows progress. Interrupted downloads resume; nothing else to type.")}</p>
  <ul className="acs-auto-list" style={{listStyle:"none",padding:0,margin:"12px 0",display:"grid",gap:8}}>
   {CAPS.map(c=>{const row=latest(c.profile),isDone=c.done(config),running=!!row&&live(row)&&active,failed=row?.state==="failed"&&row.createdAt>=new Date(started.current).toISOString();
    const pct=running&&typeof row!.progress.completed==="number"&&typeof row!.progress.total==="number"&&row!.progress.total?Math.round(100*(row!.progress.completed as number)/(row!.progress.total as number)):null;
    return <li key={c.id} className="acs-panel" style={{padding:"10px 12px"}}>
     <label style={{display:"flex",gap:10,alignItems:"flex-start"}}><input type="checkbox" disabled={active||isDone} checked={isDone||picked.includes(c.id)} onChange={()=>setPicked(p=>p.includes(c.id)?p.filter(x=>x!==c.id):[...p,c.id])}/>
      <span style={{flex:1}}><b>{t(c.vi,c.en)}</b><br/><small>{t(c.hintVi,c.hintEn)} · ~{c.gib} GB</small></span>
      <span className="acs-badge">{isDone?t("Đã cài","Installed"):running?(pct!==null?`${pct}%`:t("Đang cài","Installing")):failed?t("Cần xử lý","Needs attention"):t("Chưa cài","Not installed")}</span></label>
     {running&&<div><progress value={pct??undefined} max={100} style={{width:"100%"}}/><small>{String(row!.progress.status??"")}</small></div>}
     {failed&&<p className="acs-alert error">{row!.error}</p>}
    </li>;})}
  </ul>
  <div className="acs-actions">
   <button type="button" className="acs-primary" disabled={busy||active||!missing.length||!folder} onClick={start}>{active?t("Đang cài…","Installing…"):missing.length?t(`Cài đặt tự động (${totalGib} GB)`,`Install automatically (${totalGib} GB)`):t("Mọi mục đã chọn đã sẵn sàng","Everything ticked is ready")}</button>
   {active&&<button type="button" onClick={()=>setActive(false)}>{t("Dừng sau mục hiện tại","Stop after the current item")}</button>}
   <span className="acs-muted">{total?`${finished}/${total}`:""}</span>
  </div>
  {note&&<p role="status" className={note.includes(":")?"acs-alert error":"acs-muted"}>{note}</p>}
  <p className="acs-muted">{t("Thư mục cài đặt: ","Setup folder: ")}<code>{folder||t("(chưa xác định)","(unknown)")}</code></p>
 </section>;
}
