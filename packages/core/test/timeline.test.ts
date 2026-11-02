import {describe,it,expect} from "vitest";
import {Timeline,TimelineClip,applyTimelineEdits,planTimelinePrompt} from "../src/timeline.js";
const timeline=()=>Timeline.parse({schemaVersion:1,width:640,height:360,fps:30,duration:10,createdAt:new Date().toISOString(),clips:[
 {id:"video",track:"video",start:0,duration:10,source:"video.mp4"},{id:"dialogue",track:"dialogue",start:0,duration:10,source:"voice.wav"},
 {id:"caption",track:"caption",start:0,duration:10,text:"one two three four five six seven eight nine ten"},{id:"music",track:"music",start:0,duration:10,source:"music.wav",gain:0.2}]});
describe("Editable multitrack timeline",()=>{
 it("ripples every track and adjusts right-side source offsets without changing the parent",()=>{
  const parent=timeline(),cut=applyTimelineEdits(parent,[{kind:"remove_range",start:2,end:5}]);expect(cut.duration).toBe(7);expect(parent.duration).toBe(10);
  for(const kind of["video","dialogue","music"]){const clips=cut.clips.filter(c=>c.track===kind);expect(clips.map(c=>[c.start,c.duration,c.sourceIn])).toEqual([[0,2,0],[2,5,5]]);}
  expect(cut.clips.filter(c=>c.track==="caption").map(c=>c.text)).toEqual(["one two","six seven eight nine ten"]);
 });
 it("keeps subtitles independently editable after a cut and allows deterministic zoom and gain",()=>{
  const cut=applyTimelineEdits(timeline(),[{kind:"remove_range",start:0,end:3}]);const caption=cut.clips.find(c=>c.track==="caption")!;
  const edit=applyTimelineEdits(cut,[{kind:"set_caption",clipId:caption.id,text:"Phụ đề đã sửa"},{kind:"zoom",start:1,end:2,factor:1.2},{kind:"set_gain",track:"music",gain:0.1}]);
  expect(edit.captionTiming).toBe("manually_edited");expect(edit.clips.find(c=>c.id===caption.id)?.text).toBe("Phụ đề đã sửa");expect(edit.clips.filter(c=>c.track==="video").map(c=>[c.start,c.duration,c.zoom])).toEqual([[0,1,1],[1,1,1.2],[2,5,1]]);expect(edit.clips.find(c=>c.track==="music")?.gain).toBe(0.1);
 });
 it("rejects out-of-bounds/destructive ranges and produces explicit prompt operations",()=>{
  expect(()=>applyTimelineEdits(timeline(),[{kind:"remove_range",start:0,end:10}])).toThrow();
  expect(()=>applyTimelineEdits(timeline(),[{kind:"move_clip",clipId:"caption",start:9}])).toThrow();
  expect(planTimelinePrompt("Cut 00:02–00:05",timeline()).operations).toEqual([{kind:"remove_range",start:2,end:5}]);
  expect(planTimelinePrompt("Make it more exciting",timeline()).changesClaims).toBe(false);
  expect(()=>planTimelinePrompt("run arbitrary code",timeline())).toThrow();
 });
});
