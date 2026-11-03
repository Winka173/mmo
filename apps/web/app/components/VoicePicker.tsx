"use client";
import {useEffect,useRef,useState} from "react";
type Voice={id:string;language:string;engine:string;label:string};
const SAMPLE:Record<string,string>={"vi-VN":"Xin chào, đây là giọng đọc thử cho video của bạn.","en-US":"Hello, this is a short preview of this voice.","en-GB":"Hello, this is a short preview of this voice."};
let catalog:Promise<{voices:Voice[];defaults:Record<string,string>}>|null=null;
/** Voice choice from the installed local engines, with a short local preview. Blank inherits the project setting. */
export default function VoicePicker({language,value,onChange,en,label}:{language:"vi-VN"|"en-US"|"en-GB";value:string;onChange:(v:string)=>void;en:boolean;label:string}){
 const t=(vi:string,eng:string)=>en?eng:vi,[voices,setVoices]=useState<Voice[]>([]),[fallback,setFallback]=useState(""),[sample,setSample]=useState<{id:string;state:string}|null>(null),[error,setError]=useState(""),timer=useRef<any>(null);
 useEffect(()=>{catalog??=fetch("/api/studio/voice-catalog",{cache:"no-store"}).then(r=>r.json());void catalog.then(d=>{setVoices(d.voices.filter(v=>v.language===language));setFallback(language==="vi-VN"?d.defaults.vi:language==="en-GB"?d.defaults.enGb:d.defaults.enUs);}).catch(()=>{});return()=>clearInterval(timer.current);},[language]);
 async function preview(){
  setError("");const voice=value||fallback;if(!voice)return;
  const r=await fetch("/api/studio",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"voice-sample",language,text:SAMPLE[language],voice})}),row=await r.json();if(!r.ok){setError(row.error);return;}
  setSample({id:row.id,state:row.state});clearInterval(timer.current);
  timer.current=setInterval(async()=>{const d=await fetch("/api/studio",{cache:"no-store"}).then(x=>x.json()).catch(()=>null),s=d?.voices?.find((v:any)=>v.id===row.id);if(s){setSample({id:s.id,state:s.state});if(["ready","failed"].includes(s.state)){clearInterval(timer.current);if(s.state==="failed")setError(s.error??"failed");}}},3000);
 }
 return <div className="acs-field" data-voice-picker={language}><label>{label}<select value={value} onChange={e=>onChange(e.target.value)}><option value="">{t(`Theo cấu hình (${fallback||"chưa đặt"})`,`Inherit settings (${fallback||"not set"})`)}</option>{voices.map(v=><option key={v.id} value={v.id}>{v.label} · {v.engine}</option>)}{value&&!voices.some(v=>v.id===value)&&<option value={value}>{value}</option>}</select></label>
  <span className="acs-actions"><button type="button" onClick={()=>void preview()} disabled={!(value||fallback)||sample?.state==="queued"||sample?.state==="running"}>{sample&&["queued","running"].includes(sample.state)?t("Đang tạo mẫu…","Making sample…"):t("Nghe thử","Preview")}</button>{sample?.state==="ready"&&<audio controls autoPlay src={`/api/studio/voice/${sample.id}`}/>}</span>
  {!voices.length&&<small className="acs-muted">{t("Cài engine giọng trong Model & Công cụ để có danh sách giọng.","Install the voice engines in Models & Tools to list voices.")}</small>}{error&&<small role="alert" className="acs-alert error">{error}</small>}</div>;
}
