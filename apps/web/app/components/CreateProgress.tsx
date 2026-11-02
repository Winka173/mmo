"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import type {StudioRun} from "@ttm/automation";
import ManualExportPanel from "./ManualExport";
import PlanEditor from "./PlanEditor";

/** Displays persisted production artifacts, never predictions masquerading as results. */
export default function CreateProgress({run,step,en,busy,proceed,call,select}:{run:StudioRun;step:number;en:boolean;busy:boolean;proceed:()=>Promise<void>;call:(body:Record<string,unknown>)=>Promise<any>;select:(id:string)=>void}){
 const t=(vi:string,english:string)=>en?english:vi,[research,setResearch]=useState<any>(null),[qa,setQa]=useState<any>(null),[error,setError]=useState("");
 const media=(file:string)=>`/api/studio/media/${run.id}/${encodeURIComponent(file)}`;
 const hasResearch=run.outputs.includes("research.json"),hasQa=run.outputs.includes("qa.json");
 useEffect(()=>{let live=true;setResearch(null);setQa(null);setError("");
  for(const [file,set] of [["research.json",setResearch],["qa.json",setQa]] as const){if(!run.outputs.includes(file))continue;
   void fetch(media(file),{cache:"no-store"}).then(async response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json();}).then(value=>{if(live)set(value);}).catch(err=>{if(live)setError(err.message);});
  }return()=>{live=false;};
 },[run.id,hasResearch,hasQa]);
 const planned=run.planning?.state==="ready",rendered=run.state==="ready"&&run.outputs.includes("final.mp4");
 return <section aria-label={t("Kết quả sản xuất đã lưu","Saved production results")}>
  <header><h3>{run.title} · {run.language}</h3><span className="acs-badge">{planned?t("Kế hoạch sẵn sàng","Plan ready"):run.state}</span></header>
  <p className="acs-muted">{t("Phiên bản này giữ nguyên nguồn và cấu hình lúc tạo kế hoạch. Sửa câu hoặc media ở bước 3 để lưu thành phiên bản mới. Muốn đổi giọng/cấu hình, sửa nháp và tạo kế hoạch mới.","This version retains the sources and settings captured when planned. Edit lines or media at step 3 to save a new version. To change voice/settings, edit the draft and generate a new plan.")}</p>
  {error&&<p role="alert">{error}</p>}{run.error&&<p role="alert" className="acs-alert error">{run.error}</p>}
  <ol className="acs-stage-list">{run.stages.filter(s=>step<=3?["intake","research","script","storyboard"].includes(s.id):["voice","captions","preview","quality","render"].includes(s.id)).map(stage=><li key={stage.id}><b>{stage.id} · {stage.state}</b><p>{stage.note}</p></li>)}</ol>
  {step===2&&research&&<><h4>{t("Bằng chứng đã thu thập","Retrieved evidence")}</h4>{research.claims?.map((claim:any)=><article key={claim.id}><b>{claim.text}</b><p>{claim.status} · {t("Cần duyệt ý nghĩa và fact","Meaning and fact review required")}</p>{claim.quotes?.map((quote:any,i:number)=><blockquote key={i}>{quote.quote} <a href={quote.url} target="_blank" rel="noreferrer">{t("Nguồn","Source")}</a></blockquote>)}</article>)}<a href={media("citations.md")}>{t("Mở citations đã lưu","Open saved citations")}</a></>}
  {step===3&&run.shots.length>0&&<><h4>{t("Kịch bản và storyboard thực","Actual script and storyboard")}</h4><p>{t("Thời gian từng cảnh chưa đo trước khi tạo lời đọc. Media có mô tả được ghép theo nội dung; nguồn thiếu mô tả vẫn cần chọn và duyệt hình. Đồ họa nghiên cứu giữ theo đúng câu đã tạo.","Scene timing is unmeasured before narration. Described media is matched to the script; undescribed sources need visual selection and review. Research graphics stay attached to their authored lines.")}</p><ol className="acs-stage-list">{run.shots.map((shot,i)=><li key={i}><div><b>{t("Cảnh","Scene")} {i+1}</b><p>{shot.text}</p><small>{shot.asset.split(/[\\/]/).at(-1)||t("Chưa có media","No media yet")}</small></div></li>)}</ol>{run.outputs.includes("plan.json")&&<a href={media("plan.json")}>{t("Mở kế hoạch và hash nguồn","Open plan and source hashes")}</a>}{run.outputs.includes("source-matching.json")&&<p><a href={media("source-matching.json")}>{t("Xem bằng chứng ghép media","View media matching evidence")}</a></p>}</>}
  {step===3&&planned&&<PlanEditor run={run} en={en} busy={busy} call={call} select={select}/>}
  {step===4&&<p>{t("Giọng đã ghim","Pinned voice")}: {run.language==="vi-VN"?run.config.voiceVi:run.language==="en-GB"?run.config.voiceEnGb:run.config.voiceEn} · {run.snapshot.format} · {run.snapshot.durationSec}s {t("mục tiêu","target")}</p>}
  {step===4&&planned&&<><p>{t("Kịch bản đã lưu. Tiếp tục sẽ tạo lời đọc, phụ đề, preview và chạy QA bằng cấu hình đã ghim. Thao tác này không cấp quyền đăng.","The script is saved. Continue to produce narration, captions, preview and QA using the pinned configuration. This grants no publishing permission.")}</p><button className="acs-primary" disabled={busy} onClick={()=>void proceed()}>{t("Dựng preview từ kế hoạch này","Build preview from this plan")}</button></>}
  {step===5&&rendered&&<><video className="acs-video" controls preload="metadata" src={media("final.mp4")}/><Link href={`/studio/editor?id=${run.id}`}>{t("Biên tập phiên bản này →","Edit this version →")}</Link></>}
  {step===5&&!rendered&&<p>{t("Preview chỉ xuất hiện sau khi dựng xong. Theo dõi tiến trình ở trên; kế hoạch đã lưu vẫn được giữ khi đóng/mở app.","Preview appears after rendering finishes. Follow progress above; the saved plan survives closing and reopening the app.")}</p>}
  {step===6&&qa&&<><h4>{t("Kết quả QA của đúng phiên bản","QA for this exact version")}</h4><p>{t("Kỹ thuật","Technical")}: {String(qa.technical)} · {t("Quyền đăng","Publish eligibility")}: {qa.publishEligibility}</p><ul>{qa.findings?.filter((finding:any)=>finding.status!=="pass").map((finding:any,i:number)=><li key={i}>{finding.criterion} · {finding.status} · {finding.recommendedFix}</li>)}</ul><p>{t("Fact, quyền nguồn, biên tập và nghe giọng vẫn cần duyệt riêng.","Facts, rights, editorial quality and voice listening require separate review.")}</p><ManualExportPanel run={run} en={en}/></>}
  <Link href={`/studio/production?id=${run.id}`}>{t("Mở chi tiết Production →","Open Production details →")}</Link>
 </section>;
}
