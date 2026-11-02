"use client";
import Link from "next/link";
import type {StudioRun} from "@ttm/automation";

const REQUIRED:{vi:string;en:string;ok:(c:Record<string,any>)=>boolean}[]=[
 {vi:"Viết kịch bản",en:"Scripts",ok:c=>!!c.llmModel},
 {vi:"Chất lượng cao",en:"High quality",ok:c=>!!c.llmQualityModel},
 {vi:"Giọng Việt",en:"Vietnamese voice",ok:c=>!!c.ttsViModel},
 {vi:"Giọng Anh",en:"English voice",ok:c=>!!c.ttsEnModel},
 {vi:"Nhận dạng giọng nói",en:"Speech recognition",ok:c=>!!c.asrModel},
];
const COLORS:Record<string,string>={ready:"#2fb36b",running:"#5a7be8",needs_input:"#e0a040",other:"#d8d4ea"};

/** Home summary instead of a hero: are the local AI parts ready, and how are the runs going. One action only. */
export default function ReadinessCard({en,config,runs}:{en:boolean;config:Record<string,any>;runs:StudioRun[]}){
 const t=(vi:string,eng:string)=>en?eng:vi;
 const have=REQUIRED.filter(r=>r.ok(config)),missing=REQUIRED.filter(r=>!r.ok(config));
 const count={ready:runs.filter(r=>r.state==="ready").length,running:runs.filter(r=>r.state==="running").length,needs_input:runs.filter(r=>r.state==="needs_input").length};
 const other=Math.max(0,runs.length-count.ready-count.running-count.needs_input),total=runs.length;
 return <section className="acs-panel" aria-label={t("Sẵn sàng sản xuất","Ready to produce")} style={{display:"grid",gap:12}}>
  <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
   <div><span className="acs-eyebrow">{t("TÌNH TRẠNG","STATUS")}</span><h2 style={{margin:"4px 0 0"}}>{missing.length?t("Cần cài AI trước khi sản xuất","Install the AI parts before producing"):t("Sẵn sàng sản xuất","Ready to produce")}</h2></div>
   {missing.length?<Link className="acs-primary" href="/studio/models">{t("Cài đặt AI tự động","Install AI automatically")} →</Link>:<Link className="acs-primary" href="/studio/create">{t("Tạo nội dung","Create content")} →</Link>}
  </header>
  <div className="acs-meter" role="img" aria-label={`${have.length}/${REQUIRED.length}`}><span style={{width:`${100*have.length/REQUIRED.length}%`}}/><small>{have.length}/{REQUIRED.length} {t("thành phần AI sẵn sàng","AI parts ready")}</small></div>
  {missing.length>0&&<small className="acs-muted">{t("Còn thiếu: ","Missing: ")}{missing.map(m=>en?m.en:m.vi).join(" · ")}</small>}
  {total>0&&<><div style={{display:"flex",height:12,borderRadius:999,overflow:"hidden",background:"#ece8fb"}} role="img" aria-label={t("Tiến độ các bản sản xuất","Run progress")}>{([["ready",count.ready],["running",count.running],["needs_input",count.needs_input],["other",other]] as const).map(([k,n])=>n?<span key={k} style={{width:`${100*n/total}%`,background:COLORS[k]}}/>:null)}</div>
   <small className="acs-muted">{count.ready} {t("sẵn sàng","ready")} · {count.running} {t("đang chạy","running")} · {count.needs_input} {t("cần xử lý","need attention")}</small></>}
 </section>;
}
