import {describe,it,expect} from "vitest";
import {Timeline,applyTimelineEdits} from "../src/timeline.js";
const fixture=()=>Timeline.parse({schemaVersion:1,width:640,height:360,fps:30,duration:10,createdAt:new Date().toISOString(),captionTiming:"estimated",clips:[{id:"a",track:"caption",start:1,duration:2,text:"Giữ nguyên lời đọc"},{id:"b",track:"caption",start:5,duration:2,text:"Second phrase"},{id:"voice",track:"dialogue",start:0,duration:10,source:"original.wav"}]});
describe("caption timing edit",()=>{
 it("retimes only a caption and preserves parent and every audio field",()=>{const parent=fixture(),before=structuredClone(parent),child=applyTimelineEdits(parent,[{kind:"set_caption_timing",clipId:"a",start:.8,end:3.6}]);expect(parent).toEqual(before);expect(child.captionTiming).toBe("manually_edited");expect(child.clips[0]).toMatchObject({start:.8,duration:2.8,text:parent.clips[0].text});expect(child.clips.slice(1)).toEqual(parent.clips.slice(1));});
 it("rejects overlapping cues, invalid bounds and audio selected as a caption",()=>{for(const op of [{clipId:"a",start:4,end:6},{clipId:"a",start:2,end:1},{clipId:"a",start:8,end:11},{clipId:"voice",start:0,end:1}])expect(()=>applyTimelineEdits(fixture(),[{kind:"set_caption_timing",...op}])).toThrow();});
});
