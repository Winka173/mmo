"use client";
import {useEffect,useState} from "react";
import type {StudioRun,VoiceSample} from "@ttm/automation";
import {useRecoverableDraft} from "./useRecoverableDraft";
export default function PlanEditor({run,en,busy,call,select}:{run:StudioRun;en:boolean;busy:boolean;call:(body:Record<string,unknown>)=>Promise<any>;select:(id:string)=>void}){
 const recovered=useRecoverableDraft(`acs-plan-work-${run.id}`,run.planning?.sha256??run.snapshotHash,run.shots),{value:shots,setValue:setShots}=recovered;
 const [sample,setSample]=useState<VoiceSample|null>(null),[error,setError]=useState("");
 const t=(vi:string,eng:string)=>en?eng:vi,changed=JSON.stringify(shots)!==JSON.stringify(run.shots);
 useEffect(()=>{setSample(null);setError("");},[run.id]);
 useEffect(()=>{if(!sample||!["queued","running"].includes(sample.state))return;let live=true;
  const timer=setInterval(()=>void fetch("/api/studio",{cache:"no-store"}).then(r=>r.json()).then(data=>{if(live){const row=data.voices?.find((v:VoiceSample)=>v.id===sample.id);if(row)setSample(row);}}).catch(()=>{}),3000);
  return()=>{live=false;clearInterval(timer);};
 },[sample?.id,sample?.state]);
 const act=async(body:Record<string,unknown>,done:(value:any)=>void)=>{setError("");try{done(await call(body));}catch(e:any){setError(e.message);}};
 const patch=(index:number,value:Partial<StudioRun["shots"][number]>)=>setShots(current=>current.map((shot,i)=>i===index?{...shot,...value}:shot));
 const sourcePreview=(file:string)=>{const match=/(?:^|[\\/])([a-f0-9-]{36})[\\/]([^\\/]+)$/i.exec(file);return match?`/api/studio/media/${match[1]}/${encodeURIComponent(match[2])}`:null;};
 return <section aria-label={t("Sửa kế hoạch trước khi dựng","Edit plan before rendering")}>
  <p>{t("Sửa từng câu và chọn media đã ghim. Lưu sẽ tạo phiên bản mới, giữ nguyên kế hoạch gốc. Câu đã sửa cần duyệt fact lại; thời gian phụ đề vẫn là ước lượng.","Edit individual lines and choose pinned media. Saving creates a new version and keeps the original plan. Changed claims require fresh review; caption timing remains estimated.")}</p>
  <p role="status">{recovered.status==="saving"?t("Đang lưu nháp…","Saving draft…"):recovered.status==="error"?t("Chưa lưu được nháp","Draft save failed"):t("Đã lưu nháp trên máy","Draft saved on this device")}</p>{recovered.conflict&&<p role="alert">{t("Nháp đã thay đổi trong cửa sổ khác; kiểm tra trước khi lưu.","Draft changed in another window; review before saving")}</p>}
  {error&&<p role="alert">{error}</p>}
  {shots.map((shot,i)=><fieldset key={i} className="acs-panel"><legend>{t("Cảnh","Scene")} {i+1}</legend>
   <label className="acs-field">{t("Lời đọc","Narration")}<textarea rows={3} maxLength={1500} value={shot.text} onChange={e=>patch(i,{text:e.target.value})}/></label>
   <label className="acs-field">{t("Media đã ghim","Pinned media")}<select value={shot.asset} onChange={e=>patch(i,{asset:e.target.value,sourceStart:0,sourceDuration:null})}>{run.sources.map(source=><option key={source.file} value={source.file}>{source.file.split(/[\\/]/).at(-1)} · {source.sha256.slice(0,10)}</option>)}</select></label>
   {sourcePreview(shot.asset)&&(/\.(png|jpe?g|webp)$/i.test(shot.asset)?<img style={{maxWidth:480,width:"100%"}} alt={t("Xem media nguồn của cảnh","Scene source media preview")} src={sourcePreview(shot.asset)!}/>:<video className="acs-video" controls preload="metadata" aria-label={t("Xem đoạn nguồn","Source segment preview")} src={`${sourcePreview(shot.asset)}#t=${shot.sourceStart}${shot.sourceDuration?","+(shot.sourceStart+shot.sourceDuration):""}`}/>)}
   {/\.(mp4|mov|mkv|webm)$/i.test(shot.asset)&&<><label className="acs-field">{t("Bắt đầu tại giây nguồn","Source start (seconds)")}<input type="number" min={0} step={.1} value={shot.sourceStart} onChange={e=>patch(i,{sourceStart:Number(e.target.value)})}/></label><label className="acs-field">{t("Số giây nguồn dùng · trống: tự động","Source duration · blank: auto")}<input type="number" min={.1} step={.1} value={shot.sourceDuration??""} onChange={e=>patch(i,{sourceDuration:e.target.value===""?null:Number(e.target.value)})}/></label></>}
   <button disabled={busy||changed} onClick={()=>void act({action:"preview-plan-line",id:run.id,index:i},setSample)}>{t("Nghe thử riêng câu đã lưu","Audition this saved line")}</button>
  </fieldset>)}
  <button className="acs-primary" disabled={busy||!changed||shots.some(s=>!s.text.trim())} onClick={()=>void act({action:"revise-plan",id:run.id,expectedSha256:run.planning?.sha256,shots},value=>select(value.id))}>{t("Lưu thành phiên bản kế hoạch mới","Save as new plan version")}</button>
  {changed&&<p>{t("Lưu trước khi nghe thử hoặc dựng preview.","Save before auditioning or building the preview.")}</p>}
  {sample&&<article aria-label={t("Mẫu nghe của câu","Line audition")}><p>{sample.language} · {sample.state} · {t("Chưa được nghe duyệt","Listening review pending")}</p>{sample.state==="ready"&&<audio controls src={`/api/studio/voice/${sample.id}`}/>} {sample.error&&<p role="alert">{sample.error}</p>}</article>}
  {run.planRevision&&<p>{t("Kế hoạch gốc","Parent plan")}: <code>{run.planRevision.parentId}</code></p>}
 </section>;
}
