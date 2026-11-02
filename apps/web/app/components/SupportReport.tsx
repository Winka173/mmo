"use client";
import {useState} from "react";

/** One button for bug reports: builds a zip (facts, redacted config, failed jobs, log tails) the owner can send. */
export default function SupportReport({en}:{en:boolean}){
 const t=(vi:string,eng:string)=>en?eng:vi;
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[report,setReport]=useState<{name:string;path:string;bytes:number}|null>(null);
 async function create(){setBusy(true);setError("");try{const r=await fetch("/api/support-report",{method:"POST"});const v=await r.json();if(!r.ok)throw new Error(v.error??`HTTP ${r.status}`);setReport(v);}catch(e:any){setError(String(e.message??e));}finally{setBusy(false);}}
 return <section className="acs-panel" aria-label={t("Báo lỗi","Support report")}>
  <h2>{t("Báo lỗi","Support report")}</h2>
  <p>{t("Tạo một file zip gồm thông tin máy, cấu hình (đã ẩn thông tin cá nhân), các job lỗi gần đây và log. Không có prompt, media hay mật khẩu. Gửi file này khi cần báo lỗi.","Creates one zip with machine facts, the redacted configuration, recent failed jobs and logs. No prompts, media or credentials. Send it with a bug report.")}</p>
  <button type="button" className="acs-primary" disabled={busy} onClick={create}>{busy?t("Đang tạo…","Creating…"):t("Xuất log đầy đủ","Export full log")}</button>
  {error&&<p role="alert" className="acs-alert error">{error}</p>}
  {report&&<p role="status">{t("Đã lưu ","Saved ")}<code>{report.path}</code> ({(report.bytes/1024).toFixed(0)} KB) · <a href={`/api/support-report?name=${encodeURIComponent(report.name)}`} download>{t("Tải xuống","Download")}</a></p>}
 </section>;
}
