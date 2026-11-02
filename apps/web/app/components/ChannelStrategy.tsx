"use client";
import {useEffect,useState} from "react";
import Link from "next/link";

const uuid=()=>crypto.randomUUID();
/** Section 12: build a channel (Facebook Page first) from a strategy, pillars and series; every idea needs the owner's approval. */
export default function ChannelStrategy({en,channels}:{en:boolean;channels:any[]}){
 const t=(vi:string,eng:string)=>en?eng:vi;
 const [data,setData]=useState<any[]>([]),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[channelId,setChannelId]=useState("");
 async function load(){const r=await fetch("/api/studio/strategy",{cache:"no-store"});if(r.ok)setData((await r.json()).strategies);}
 useEffect(()=>{void load();},[]);
 async function post(body:any,done:string){setBusy(true);setError("");setNotice("");try{const r=await fetch("/api/studio/strategy",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error);setNotice(done);await load();return j;}catch(e:any){setError(e.message);return null;}finally{setBusy(false);}}
 const candidates=channels.filter(c=>c.platform==="facebook_reels").concat(channels.filter(c=>c.platform!=="facebook_reels"));
 const selected=channelId||candidates[0]?.id||"",strategy=data.find(s=>s.channelId===selected);
 // One line per series: "Pillar | Series | factory | per week | idea 1; idea 2"
 const toLines=(s:any)=>s?s.series.map((x:any)=>[s.pillars.find((p:any)=>p.id===x.pillarId)?.name,x.name,x.family,x.perWeek,x.ideas.join("; ")].join(" | ")).join("\n"):"";
 function parse(text:string,old:any){
  const pillars:any[]=[],series:any[]=[];
  for(const line of text.split("\n").map(l=>l.trim()).filter(Boolean)){
   const [pillar,name,family="custom",perWeek="1",ideas=""]=line.split("|").map(x=>x.trim());if(!pillar||!name)throw new Error(t("Mỗi dòng cần: Pillar | Series | factory | số bài/tuần | ý tưởng; ý tưởng","Each line needs: Pillar | Series | factory | posts/week | idea; idea"));
   let p=pillars.find(x=>x.name===pillar);if(!p){p={id:old?.pillars.find((x:any)=>x.name===pillar)?.id??uuid(),name:pillar};pillars.push(p);}
   series.push({id:old?.series.find((x:any)=>x.name===name)?.id??uuid(),pillarId:p.id,name,family:["game","facts","product","custom"].includes(family)?family:"custom",perWeek:Math.max(1,Math.min(7,Number(perWeek)||1)),ideas:ideas.split(";").map(x=>x.trim()).filter(x=>x.length>=3)});
  }
  return {pillars,series};
 }
 const monday=()=>{const d=new Date();d.setUTCDate(d.getUTCDate()+((8-d.getUTCDay())%7||7));return d.toISOString().slice(0,10);};
 if(!channels.length)return <section className="acs-panel" aria-label={t("Xây kênh","Channel building")}><h2>{t("Xây kênh theo chiến lược","Strategy-led channel building")}</h2><p>{t("Thêm một kênh (ví dụ Facebook Page Reels) ở trên trước.","Add a channel (for example Facebook Page Reels) above first.")}</p></section>;
 return <section className="acs-panel" aria-label={t("Xây kênh","Channel building")}>
  <h2>{t("Xây kênh theo chiến lược","Strategy-led channel building")}</h2>
  <p>{t("Hồ sơ kênh → pillar/series → kế hoạch tuần → bạn duyệt từng ý tưởng → bản nháp Autopilot ở factory phù hợp → duyệt 4 phạm vi và cho phép đăng từng phiên bản như thường lệ → số liệu thật theo series. Chỉ Reels/video; bài chữ/ảnh chưa được xây.","Channel profile → pillars/series → weekly plan → you approve each idea → a draft Autopilot in the matching factory → the usual four reviews and per-version publish authorization → real metrics per series. Reels/video only; text/image posts are not built.")}</p>
  {error&&<p role="alert" className="acs-alert error">{error}</p>}{notice&&<p role="status" className="acs-alert">{notice}</p>}
  <label className="acs-field">{t("Kênh","Channel")}<select value={selected} onChange={e=>setChannelId(e.target.value)}>{candidates.map(c=><option key={c.id} value={c.id}>{c.name} · {c.platform}</option>)}</select></label>
  <form key={`${selected}-${strategy?.revision??0}`} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const {pillars,series}=parse(String(f.get("series")),strategy);void post({action:"save",value:{...(strategy?{id:strategy.id,revision:strategy.revision}:{}),channelId:selected,goal:f.get("goal"),audience:f.get("audience"),language:f.get("language"),tone:f.get("tone"),cta:f.get("cta"),avoid:String(f.get("avoid")).split(";").map(x=>x.trim()).filter(Boolean),pillars,series}},t("Đã lưu chiến lược","Strategy saved"));}catch(err:any){setError(err.message);}}}>
   <div className="acs-form-grid"><label className="acs-field">{t("Mục tiêu kênh","Channel goal")}<input name="goal" required minLength={3} defaultValue={strategy?.goal??""}/></label><label className="acs-field">{t("Khán giả","Audience")}<input name="audience" defaultValue={strategy?.audience??""}/></label>
   <label className="acs-field">{t("Ngôn ngữ","Language")}<select name="language" defaultValue={strategy?.language??"vi-VN"}><option>vi-VN</option><option>en-US</option><option>en-GB</option></select></label><label className="acs-field">{t("Giọng điệu","Tone")}<input name="tone" defaultValue={strategy?.tone??"clear"}/></label>
   <label className="acs-field">CTA<input name="cta" defaultValue={strategy?.cta??""}/></label><label className="acs-field">{t("Tránh (ngăn bằng ;)","Avoid (separate with ;)")}<input name="avoid" defaultValue={strategy?.avoid.join("; ")??""}/></label></div>
   <label className="acs-field">{t("Pillar | Series | factory (game/facts/product/custom) | bài/tuần | ý tưởng; ý tưởng","Pillar | Series | factory (game/facts/product/custom) | posts/week | idea; idea")}<textarea name="series" rows={4} required defaultValue={toLines(strategy)} placeholder="Hướng dẫn | Mẹo tuần | game | 2 | Đặt tháp cơ bản; Tháp chậm vs tháp nhanh"/></label>
   <button className="acs-primary" disabled={busy}>{t("Lưu chiến lược","Save strategy")}</button></form>
  {strategy&&<><div className="acs-actions"><button disabled={busy} onClick={()=>void post({action:"week",id:strategy.id,weekStart:monday()},t("Đã đề xuất kế hoạch tuần tới","Next week's plan proposed")).then(r=>{if(r?.held?.length)setNotice(`${t("Thiếu ý tưởng","Backlog short")}: ${r.held.join(" · ")}`);})}>{t("Đề xuất kế hoạch tuần tới","Propose next week's plan")}</button></div>
   <div style={{overflowX:"auto"}}><table aria-label={t("Kế hoạch","Plan")}><thead><tr><th>{t("Ngày","Date")}</th><th>Series</th><th>{t("Ý tưởng","Idea")}</th><th>{t("Trạng thái","Status")}</th><th></th></tr></thead><tbody>{strategy.plan.map((i:any)=><tr key={i.id}><td>{i.date}</td><td>{strategy.series.find((s:any)=>s.id===i.seriesId)?.name}</td><td>{i.idea}</td><td>{({proposed:t("Chờ bạn duyệt","Awaiting your approval"),approved:t("Đã duyệt → bản nháp","Approved → draft"),rejected:t("Đã bỏ","Rejected")} as any)[i.state]}</td><td>{i.state==="proposed"?<span className="acs-actions"><button disabled={busy} onClick={()=>void post({action:"decide",id:strategy.id,itemId:i.id,decision:"approved"},t("Đã tạo bản nháp Autopilot (chưa bật)","Draft Autopilot created (disabled)"))}>{t("Duyệt","Approve")}</button><button disabled={busy} onClick={()=>void post({action:"decide",id:strategy.id,itemId:i.id,decision:"rejected"},t("Đã bỏ ý tưởng","Idea rejected"))}>{t("Bỏ","Reject")}</button></span>:i.autopilotId?<Link href={`/studio/autopilots?id=${i.autopilotId}`}>{t("Mở bản nháp →","Open draft →")}</Link>:null}</td></tr>)}</tbody></table></div>
   {!strategy.plan.length&&<p>{t("Chưa có kế hoạch. Bấm đề xuất để lấy ý tưởng từ backlog của từng series.","No plan yet. Propose one to take ideas from each series' backlog.")}</p>}
   <h3>{t("Hiệu quả theo series","Results by series")}</h3><div style={{overflowX:"auto"}}><table><thead><tr><th>Pillar</th><th>Series</th><th>{t("Đã duyệt","Approved")}</th><th>{t("Đã dựng","Produced")}</th><th>{t("Đã đăng","Posted")}</th><th>{t("Lượt xem TB","Avg views")}</th></tr></thead><tbody>{strategy.performance.rows.map((r:any)=><tr key={r.seriesId}><td>{r.pillar}</td><td>{r.series}</td><td>{r.approved}</td><td>{r.produced}</td><td>{r.posts}</td><td>{r.averageViews==null?t("Chưa biết","Unknown"):`${Math.round(r.averageViews)} (n=${r.withViews})`}</td></tr>)}</tbody></table></div>
   <p className="acs-muted">{strategy.performance.suggestions.map((s:string)=>/^Not enough data/.test(s)&&!en?`Chưa đủ dữ liệu: cần ít nhất hai series, mỗi series ${strategy.performance.minSamples} bài có lượt xem. Lượt xem không chứng minh người theo dõi, doanh thu hay chuyển đổi.`:s).join(" ")}</p></>}
 </section>;
}
