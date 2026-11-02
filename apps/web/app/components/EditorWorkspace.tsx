"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import type {StudioRun} from "@ttm/automation";
import TimelineEditor from "./TimelineEditor";
import TranscriptEditor from "./TranscriptEditor";
import RepairPlanner from "./RepairPlanner";
import FootageAnalysis from "./FootageAnalysis";
import ManualExportPanel from "./ManualExport";
import VersionCompare from "./VersionCompare";
import {useRecoverableDraft} from "./useRecoverableDraft";
import "./editor-workspace.css";
import {editorScenes} from "./editor-scenes";
import ContentInsights from "./ContentInsights";
import NarrationPacing from "./NarrationPacing";
import StudioActionNotice,{ActionButton} from "./StudioActionNotice";
const artifact=(run:StudioRun,file:string)=>`/api/studio/media/${run.id}/${encodeURIComponent(file)}`;
export default function EditorWorkspace({run,runs,en,busy,call,select}:{run:StudioRun;runs:StudioRun[];en:boolean;busy:boolean;call:(b:Record<string,unknown>)=>Promise<any>;select:(id:string)=>void}){
 const t=(vi:string,eng:string)=>en?eng:vi,[scene,setScene]=useState(0),[tab,setTab]=useState("scene"),[error,setError]=useState(""),preview=useRef<HTMLVideoElement>(null),[timeline,setTimeline]=useState<any>(null);
 const draft=useRecoverableDraft(`acs-editor-lines-${run.id}`,run.snapshotHash+":"+run.updatedAt,run.shots.map(s=>s.text));
 useEffect(()=>{let live=true;setScene(0);setError("");setTimeline(null);if(run.outputs.includes("timeline.json"))void fetch(`/api/studio/timeline/${run.id}`).then(r=>r.ok?r.json():null).then(value=>{if(live)setTimeline(value);}).catch(()=>{});return()=>{live=false;};},[run.id]);
 const scenes=editorScenes(run.shots,["cut","timeline"].includes(run.edit?.kind??""),timeline);
 const seek=(index:number)=>{setScene(index);if(preview.current&&scenes[index])preview.current.currentTime=scenes[index].start;};
 const sceneAt=(seconds:number)=>{const index=scenes.findIndex(row=>seconds>=row.start-.002&&seconds<row.start+row.duration-.002);if(index>=0)setScene(index);};
 const selectedScene=scenes[scene],shotIndex=selectedScene?.shotIndex??null,shot=shotIndex===null?undefined:run.shots[shotIndex],sourceUrl=(file:string)=>{const parts=/([a-f0-9-]{36})[\\/]([^\\/]+)$/i.exec(file);return parts?`/api/studio/media/${parts[1]}/${encodeURIComponent(parts[2])}`:null;};
 return <section className="acs-editor-workspace" aria-label={t("Không gian biên tập","Editing workspace")}>
  <header className="acs-editor-top"><label className="acs-field">{t("Video và phiên bản","Video and version")}<select value={run.id} onChange={e=>select(e.target.value)}>{runs.map(row=><option value={row.id} key={row.id}>{row.title} · {row.language} · {new Date(row.createdAt).toLocaleString(en?"en-US":"vi-VN")}</option>)}</select></label><span className="acs-badge">{run.state}</span><Link href={`/studio/production?id=${run.id}`}>{t("Xem tiến trình","View production")}</Link></header>
  <div className="acs-editor-grid"><aside className="acs-editor-scenes acs-panel" aria-label={t("Danh sách cảnh","Scene list")}><h2>{t("Cảnh","Scenes")}</h2>{scenes.map((s,i)=><button key={s.id} aria-pressed={i===scene} className={i===scene?"active":""} onClick={()=>seek(i)}>{sourceUrl(s.source)&&(/\.(png|jpe?g|webp)$/i.test(s.source)?<img alt="" src={sourceUrl(s.source)!}/>:<video muted preload="metadata" src={`${sourceUrl(s.source)}#t=${s.sourceIn+.1}`}/>)}<b>{i+1}. {s.text.slice(0,72)||t("Clip timeline","Timeline clip")}</b><small>{s.duration.toFixed(1)}s</small></button>)}{!scenes.length&&<p>{t("\u004d\u1ed1c c\u1ea3nh ch\u1edd timeline; m\u1edf tab Timeline \u0111\u1ec3 xem b\u1ea3n \u0111\u00e3 c\u1eaft.","Scene positions await the saved timeline; open Timeline to inspect this edited version.")}</p>}</aside>
  <div className="acs-editor-center"><div className="acs-editor-preview acs-panel">{run.outputs.includes("final.mp4")?<video ref={preview} controls preload="metadata" className="acs-video" src={artifact(run,"final.mp4")} onTimeUpdate={e=>sceneAt(e.currentTarget.currentTime)}/>:<p>{t("Video đang chờ dựng. Media nguồn và kế hoạch vẫn được giữ.","The preview is awaiting render. Source media and the plan are retained.")}</p>}<p>{t("Đang chọn cảnh","Selected scene")}: {scenes.length?scene+1:0}/{scenes.length} · {run.language}</p></div>
   <div className="acs-editor-tabs" role="tablist" aria-label={t("Công cụ biên tập","Editing tools")}>{[["scene","Cảnh & Lời đọc","Scene & narration"],["timeline","Timeline","Timeline"],["captions","Phụ đề & Sóng âm","Captions & waveform"],["quality","Chất lượng","Quality"],["versions","So sánh phiên bản","Compare versions"],["export","Xuất & Đăng","Export & Publish"]].map(([id,vi,eng])=><button role="tab" aria-selected={tab===id} key={id} onClick={()=>setTab(id)}>{t(vi,eng)}</button>)}</div>
   <div className="acs-panel" role="tabpanel">{error&&<StudioActionNotice message={error} en={en}/>}
    {tab==="scene"&&<p>{t("Chọn cảnh để nghe và xem đúng đoạn, rồi sửa lời đọc trong bảng bên phải. Bản gốc được giữ khi áp dụng.","Choose a scene to review its segment, then edit narration in the inspector. Applying creates a new version.")}</p>}
    {tab==="timeline"&&<TimelineEditor run={run} en={en} busy={busy} call={call} select={select}/>}
    {tab==="captions"&&<TranscriptEditor run={run} en={en} busy={busy} call={call} select={select} onSeek={seconds=>{if(preview.current)preview.current.currentTime=seconds;}}/>}
    {tab==="quality"&&<><NarrationPacing runId={run.id} en={en}/><ContentInsights runId={run.id} en={en}/><RepairPlanner run={run} en={en} busy={busy} call={call} select={select}/><FootageAnalysis run={run} en={en}/>{run.outputs.includes("qa.json")&&<a href={artifact(run,"qa.json")}>{t("Bằng chứng QA chi tiết","Detailed QA evidence")}</a>}</>}
    {tab==="versions"&&<VersionCompare run={run} runs={runs} en={en}/>}
    {tab==="export"&&<><ManualExportPanel run={run} en={en}/><Link href={`/studio/channels?id=${run.id}`}>{t("Mở kênh và kiểm tra quyền đăng","Open channels and publication permissions")}</Link></>}
   </div>
  </div>
  <aside className="acs-editor-inspector acs-panel"><h2>{t("Chỉnh cảnh","Scene inspector")} {scene+1}</h2>{shot&&<><form onSubmit={async e=>{e.preventDefault();try{setError("");const next=await call({action:"revise-narration",id:run.id,index:shotIndex,text:draft.value[shotIndex!]});select(next.id);}catch(err:any){setError(err.message);}}}><label className="acs-field" htmlFor="editor-scene-narration">{t("Lời đọc cảnh","Scene narration")}</label><textarea id="editor-scene-narration" rows={8} value={draft.value[shotIndex!]??shot.text} onChange={e=>draft.setValue(current=>current.map((text,i)=>i===shotIndex?e.target.value:text))}/><p role="status">{draft.status==="saving"?t("Đang lưu nháp…","Saving draft…"):draft.status==="error"?t("Chưa lưu được nháp trên máy","Local draft could not be saved"):t("Đã lưu nháp trên máy","Draft saved on this device")}</p>{draft.conflict&&<p role="alert">{t("Nháp đã thay đổi trong cửa sổ khác; kiểm tra trước khi áp dụng.","The draft changed in another window; review before applying.")}</p>}<ActionButton className="acs-primary" reason={run.snapshot.family==="shorts"?t("Lời nói gốc chỉ được cắt; không viết lại bằng TTS.","Original speech can be trimmed, not rewritten with TTS."):["cut","timeline"].includes(run.edit?.kind??"")?t("Mở bản narration gốc để sửa lời đọc.","Open the original narration version to revise speech."):run.state!=="ready"?t("Chờ phiên bản này dựng xong.","Wait for this version to finish."):undefined} disabled={busy||run.state!=="ready"||run.snapshot.family==="shorts"||["cut","timeline"].includes(run.edit?.kind??"")||draft.value[shotIndex!]===shot.text}>{t("Đọc lại cảnh thành bản mới","Re-narrate scene as new version")}</ActionButton><button type="button" disabled={busy} onClick={draft.discard}>{t("Khôi phục lời bản gốc","Restore original draft text")}</button></form>
   <p>{t("Lời gốc","Original text")}: {shot.text}</p><p>{t("Nguồn","Source")}: {(selectedScene?.source??shot.asset).split(/[\\/]/).at(-1)}</p><p>{t("Thời lượng","Duration")}: {(selectedScene?.duration??shot.durationSec).toFixed(2)}s</p>{timeline&&<p>{t("Số track đã lưu","Saved track clips")}: {timeline.clips.length}</p>}
   {run.state!=="ready"&&<p>{t("Chờ phiên bản dựng xong để áp dụng sửa lời. Nháp đang nhập vẫn được lưu.","Wait for this version to finish before applying narration edits. Your draft is retained.")}</p>}
   <details><summary>{t("Thông tin kỹ thuật","Technical details")}</summary><code className="acs-wrap">{shot.asset}</code><p>{run.snapshotHash}</p></details>
  </>}</aside></div>
 </section>;
}
