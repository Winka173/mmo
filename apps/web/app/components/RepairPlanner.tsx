"use client";
import {useEffect,useState} from "react";
import type {StudioRun} from "@ttm/automation";
export default function RepairPlanner({run,en,busy,call,select}:{run:StudioRun;en:boolean;busy:boolean;call:(body:Record<string,unknown>)=>Promise<any>;select:(id:string)=>void}){
 const [plan,setPlan]=useState<any>(null),[error,setError]=useState(""),t=(vi:string,eng:string)=>en?eng:vi;
 useEffect(()=>{setPlan(null);setError("");},[run.id]);
 const load=async()=>{try{setError("");setPlan(await call({action:"repair-plan",id:run.id}));}catch(e:any){setError(e.message);}};
 const repair=async(kind:string)=>{try{setError("");const child=await call({action:"repair-version",id:run.id,kind,expectedPlanSha256:plan.sha256});select(child.id);}catch(e:any){setError(e.message);}};
 return <section className="acs-panel" aria-label="Repair Planner"><header><h3>{t("Kế hoạch sửa theo lỗi QA","Repair Planner")}</h3><button disabled={busy||!run.outputs.includes("timeline.json")&&run.state!=="failed"} onClick={()=>void load()}>{t("Phân tích bản QA đã lưu","Inspect saved QA")}</button></header>
  <p>{t("Chỉ sửa từ QA của phiên bản này; giữ nguồn, kịch bản và giọng đã tạo. Tối đa 2 lần cho mỗi loại lỗi trong chuỗi sửa. Không cấp quyền đăng.","Repair from this version's saved QA; keep original sources, script and narration. At most two attempts per repair kind across the repair chain. No publishing permission is granted.")}</p>
  {error&&<p role="alert">{error}</p>}{plan&&<>{!plan.operations.length&&<p>{t("Không có lỗi phù hợp để tự sửa. Fact, quyền nguồn hoặc lựa chọn biên tập cần bằng chứng và duyệt riêng.","No supported automatic repair is indicated. Facts, rights and editorial choices need separate evidence and review.")}</p>}
  {plan.operations.map((op:any)=><article key={op.kind}><b>{op.kind} · {op.attemptsUsed}/{op.maxAttempts}</b><p>{op.method}</p><small>{t("Chạy lại","Rerun")}: {op.invalidatedStages.join(" → ")}</small><p><button disabled={busy||!op.available} onClick={()=>void repair(op.kind)}>{op.available?t("Sửa thành phiên bản mới","Repair as new version"):t("Đã hết lượt sửa","Retry budget exhausted")}</button></p></article>)}
  {plan.history.length>0&&<details><summary>{t("Lịch sử sửa","Repair history")}</summary><ul>{plan.history.map((r:any)=><li key={r.id}><button onClick={()=>select(r.id)}>{r.id.slice(0,8)} · {r.kind} · {r.state}</button></li>)}</ul></details>}</>}
 </section>;
}
