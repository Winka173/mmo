import {z} from "zod";
export const ProductionSchedule=z.object({enabled:z.boolean().default(false),weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7).default([0,1,2,3,4,5,6]),startHour:z.number().int().min(0).max(23).default(8),endHour:z.number().int().min(1).max(24).default(22),embargoUntil:z.string().datetime().nullable().default(null),expiresAt:z.string().datetime().nullable().default(null),dailyLimit:z.number().int().min(1).max(50).default(4),weeklyLimit:z.number().int().min(1).max(200).default(20),maxBacklog:z.number().int().min(1).max(50).default(4)}).refine(s=>s.startHour!==s.endHour,{message:"Production window must span at least one hour"});
export type ProductionSchedule=z.infer<typeof ProductionSchedule>;
type Pilot={id:string;timezone:string;languages:string[];schedule:ProductionSchedule};
type Run={autopilotId:string;createdAt:string;trigger?:string;state:string};
const formatters=new Map<string,Intl.DateTimeFormat>();
function wall(date:Date,timezone:string){let formatter=formatters.get(timezone);if(!formatter){formatter=new Intl.DateTimeFormat("en-US",{timeZone:timezone,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"numeric",weekday:"short"});formatters.set(timezone,formatter);}const parts=formatter.formatToParts(date),get=(type:string)=>parts.find(p=>p.type===type)!.value;const day=`${get("year")}-${get("month")}-${get("day")}`,weekday=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(get("weekday"));const monday=new Date(`${day}T12:00:00Z`);monday.setUTCDate(monday.getUTCDate()-(weekday+6)%7);return{day,week:monday.toISOString().slice(0,10),weekday,hour:Number(get("hour"))};}
export function productionSlot(pilot:Pilot,now:Date,runs:Run[]){
 const s=ProductionSchedule.parse(pilot.schedule);wall(now,pilot.timezone); // Validate the IANA timezone even when advanced scheduling is off.
 if(!s.enabled)return{allowed:true,reason:"Advanced production schedule disabled",nextAt:null};
 const own=runs.filter(r=>r.autopilotId===pilot.id&&r.trigger!=="edit"&&r.state!=="cancelled"),variants=new Set(pilot.languages).size;
 const backlog=own.filter(r=>["queued","running","needs_input"].includes(r.state)).length;
 if(backlog+variants>s.maxBacklog)return{allowed:false,reason:`Backlog cap: ${backlog}/${s.maxBacklog}; resume or resolve existing work first`,nextAt:new Date(now.getTime()+3600000).toISOString()};
 if(s.expiresAt&&now.getTime()>=Date.parse(s.expiresAt))return{allowed:false,reason:"Topic / campaign has expired",nextAt:null};
 const blocked=(date:Date)=>{
  if(s.embargoUntil&&date.getTime()<Date.parse(s.embargoUntil))return"Campaign embargo";if(s.expiresAt&&date.getTime()>=Date.parse(s.expiresAt))return"Topic / campaign has expired";
  const local=wall(date,pilot.timezone),hours=s.startHour<s.endHour?local.hour>=s.startHour&&local.hour<s.endHour:local.hour>=s.startHour||local.hour<s.endHour;
  if(!s.weekdays.includes(local.weekday)||!hours)return"Outside allowed production hours / weekdays";
  const past=own.filter(r=>Date.parse(r.createdAt)<=date.getTime()).map(r=>wall(new Date(r.createdAt),pilot.timezone));
  if(past.filter(r=>r.day===local.day).length+variants>s.dailyLimit)return"Daily output cap";if(past.filter(r=>r.week===local.week).length+variants>s.weeklyLimit)return"Weekly output cap";return null;
 };
 const reason=blocked(now);if(!reason)return{allowed:true,reason:"Inside owner-configured production window and limits",nextAt:null};
 for(let minutes=15;minutes<=15*24*60;minutes+=15){const candidate=new Date(now.getTime()+minutes*60000);if(!blocked(candidate))return{allowed:false,reason,nextAt:candidate.toISOString()};}
 return{allowed:false,reason,nextAt:null};
}
