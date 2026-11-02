"use client";
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from "react";
import {createPortal} from "react-dom";

type Sys={gpu:{available:boolean;name:string|null;vramTotalMb:number|null;vramUsedMb:number|null;utilizationPct:number|null;temperatureC:number|null};ram:{totalGb:number;freeGb:number};disk:{totalGb:number;freeGb:number}|null};
type Id="vram"|"ram"|"disk";
const gb=(mb:number|null)=>mb===null?"-":(mb/1024).toFixed(1);

/** VRAM, RAM and Disk chips: one style, click for details. The popover is drawn in a portal so nothing clips or covers it. */
export default function ResourceChips({en}:{en:boolean}){
 const t=(vi:string,eng:string)=>en?eng:vi;
 const [sys,setSys]=useState<Sys|null>(null),[open,setOpen]=useState<Id|null>(null),[rect,setRect]=useState<DOMRect|null>(null);
 const refs=useRef<Record<string,HTMLButtonElement|null>>({}),panel=useRef<HTMLDivElement>(null);
 useEffect(()=>{let alive=true;const load=()=>fetch("/api/system",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(v=>{if(alive&&v)setSys(v);}).catch(()=>{});load();const timer=setInterval(load,3000);return()=>{alive=false;clearInterval(timer);};},[]);
 useLayoutEffect(()=>{setRect(open?refs.current[open]?.getBoundingClientRect()??null:null);},[open,sys?.gpu.vramUsedMb]);
 useEffect(()=>{
  if(!open)return;
  const close=(e:Event)=>{if(e instanceof KeyboardEvent){if(e.key==="Escape")setOpen(null);return;}const n=e.target as Node;if(panel.current?.contains(n)||refs.current[open]?.contains(n))return;setOpen(null);};
  const away=()=>setOpen(null);
  document.addEventListener("mousedown",close);document.addEventListener("keydown",close);window.addEventListener("resize",away);window.addEventListener("scroll",away,true);
  return()=>{document.removeEventListener("mousedown",close);document.removeEventListener("keydown",close);window.removeEventListener("resize",away);window.removeEventListener("scroll",away,true);};
 },[open]);
 if(!sys)return null;
 const g=sys.gpu,ramWarn=sys.ram.freeGb<26,diskWarn=!!sys.disk&&sys.disk.freeGb<50;
 const chip=(id:Id,label:string,warn:boolean,aria:string)=><button key={id} type="button" ref={el=>{refs.current[id]=el;}} className={`acs-chip${warn?" warn":""}`} aria-expanded={open===id} aria-haspopup="dialog" aria-label={aria} onClick={()=>setOpen(v=>v===id?null:id)}><i aria-hidden="true"/>{label}</button>;
 const meter=(used:number,total:number,text:string)=><div className="acs-meter"><span style={{width:`${Math.min(100,100*used/Math.max(total,1))}%`}}/><small>{text}</small></div>;
 let body:ReactNode=null;
 if(open==="vram")body=<><b>{g.available?g.name?.replace("NVIDIA GeForce ",""):t("Không đọc được GPU","GPU status unavailable")}</b>{g.available&&g.vramTotalMb!==null&&g.vramUsedMb!==null&&meter(g.vramUsedMb,g.vramTotalMb,`${gb(g.vramUsedMb)} / ${gb(g.vramTotalMb)} GB VRAM`)}<small>{g.available?`GPU ${g.utilizationPct??"-"}% · ${g.temperatureC??"-"}°C`:""}</small><small>{t("Đo cả thiết bị: game hoặc app khác đang dùng VRAM cũng được tính. ACS chờ thay vì tải model khi VRAM không đủ.","Whole-device measurement: a game or another app using VRAM counts. ACS waits instead of loading a model when VRAM is short.")}</small></>;
 if(open==="ram")body=<><b>{t("Bộ nhớ RAM","Memory")}</b>{meter(sys.ram.totalGb-sys.ram.freeGb,sys.ram.totalGb,`${(sys.ram.totalGb-sys.ram.freeGb).toFixed(1)} / ${sys.ram.totalGb} GB · ${t("trống","free")} ${sys.ram.freeGb} GB`)}<small>{ramWarn?t("Dưới 26 GB trống: model chất lượng cao (CPU, ~20 GB) sẽ chờ.","Under 26 GB free: the high-quality CPU model (about 20 GB) will wait."):t("Model chất lượng cao cần ~20 GB RAM trống khi chạy.","The high-quality model needs about 20 GB free RAM while it runs.")}</small></>;
 if(open==="disk"&&sys.disk)body=<><b>{t("Ổ lưu dữ liệu","Data drive")}</b>{meter(sys.disk.totalGb-sys.disk.freeGb,sys.disk.totalGb,`${sys.disk.freeGb} GB ${t("trống trên","free of")} ${sys.disk.totalGb} GB`)}<small>{diskWarn?t("Dung lượng thấp.","Free space is low."):""}</small></>;
 const style=rect?{top:rect.bottom+8,right:Math.max(8,window.innerWidth-rect.right)}:undefined;
 return <div className="acs-chips" aria-label={t("Tài nguyên máy","Machine resources")}>
  {chip("ram",`RAM ${(sys.ram.totalGb-sys.ram.freeGb).toFixed(0)} / ${sys.ram.totalGb} GB`,ramWarn,t("Trạng thái RAM","Memory status"))}
  {sys.disk&&chip("disk",`${t("Ổ đĩa","Disk")} ${sys.disk.freeGb} GB ${t("trống","free")}`,diskWarn,t("Trạng thái ổ đĩa","Disk status"))}
  {chip("vram",g.available&&g.vramUsedMb!==null?`VRAM ${gb(g.vramUsedMb)} / ${gb(g.vramTotalMb)} GB`:"GPU",false,t("Trạng thái GPU","GPU status"))}
  {open&&body&&createPortal(<div ref={panel} role="dialog" className="acs-popover" style={style}>{body}</div>,document.body)}
 </div>;
}
