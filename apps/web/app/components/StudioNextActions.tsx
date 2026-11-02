"use client";
import Link from "next/link";
import { nextActions, type NextActionInput } from "./studio-guidance";

export default function StudioNextActions({data,en}:{data:NextActionInput;en:boolean}){
 const actions=nextActions(data,en);
 return <section className="acs-panel acs-next-actions" aria-labelledby="acs-next-actions-title"><header><div><h2 id="acs-next-actions-title">{en?"Your next steps":"Việc tiếp theo"}</h2><p className="acs-muted">{en?"From saved workspace status. Opening a step never starts production or publishes anything.":"Dựa trên trạng thái đã lưu. Mở một bước không tự chạy sản xuất hoặc đăng nội dung."}</p></div></header><div className="acs-next-action-grid">{actions.map(action=><article key={action.id} className={`acs-next-action ${action.tone}`} data-next-action={action.id}><span className="acs-badge">{action.tone==="attention"?(en?"Needs attention":"Cần xử lý"):action.tone==="ready"?(en?"Ready to review":"Sẵn sàng xem duyệt"):(en?"Continue":"Tiếp tục")}</span><h3>{action.title}</h3><p>{action.detail}</p><Link className={action===actions[0]?"acs-primary":"acs-link-button"} href={action.href}>{action.action} →</Link></article>)}</div></section>;
}
