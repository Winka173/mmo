import {describe,it,expect} from "vitest";
import {relaxCueTiming} from "../src/studio-caption-evidence.js";
import {inspectCaptionCues} from "../../../packages/media/src/caption-quality.js";

// Cue timing measured in the 02/11 trial (caption-quality.json): 9 reading-speed / minimum-duration findings.
const trial=[[0.066,1.836,"Giới thiệu 'Lane Keeper', tựa game thủ"],[1.836,3.23,"thành 3 làn đường do nhóm tự làm."],[3.634,5.201,"Người chơi đặt tháp trên ba làn để"],[5.201,6.446,"chặn đứng các đợt quái vật."],[6.866,7.803,"Hai loại tháp chính:"],[7.803,9.934,"tháp cung bắn nhanh và tháp phép làm chậm."],[10.398,12.283,"Mỗi màn gồm năm đợt, với trùm xuất"],[12.283,13.306,"hiện ở màn cuối cùng."],[13.701,15.093,"Tựa game đang trong giai đoạn thử"],[15.093,17.085,"nghiệm nội bộ, chưa xác định ngày phát"],[17.085,17.761,"hành hay giá cả."]].map(([start,end,text])=>({start:start as number,end:end as number,text:text as string}));
const lines=[{start:0,count:2,aligned:false},{start:2,count:2,aligned:false},{start:4,count:2,aligned:false},{start:6,count:2,aligned:false},{start:8,count:3,aligned:false}];
const opts={duration:18.133,width:1080,fontSize:56};
describe("Caption reading-time pass",()=>{
 it("turns the trial's 9 reading-speed/short-cue findings into a pass without crossing into another line",()=>{
  const before=inspectCaptionCues(trial.map(c=>({...c})),opts);expect(before.findings.length).toBe(9);
  const cues=trial.map(c=>({...c})),info=relaxCueTiming(cues,lines,18.133);
  const after=inspectCaptionCues(cues,opts);expect(after.findings).toEqual([]);expect(after.status).toBe("pass");expect(info.changedCues).toBeGreaterThan(0);
  for(const l of lines.slice(1))expect(cues[l.start].start).toBeGreaterThanOrEqual(trial[l.start-1].end-1e-9);
  for(let i=1;i<cues.length;i++)expect(cues[i].start).toBeGreaterThanOrEqual(cues[i-1].end-1e-9);
 });
});
