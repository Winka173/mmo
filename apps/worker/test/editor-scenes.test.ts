import {describe,it,expect} from "vitest";
import {editorScenes} from "../../web/app/components/editor-scenes.js";
describe("Editor scene projection",()=>{
 const shots=[0,1,2].map(i=>({asset:`source-${i}.png`,text:`Original line ${i}`,sourceStart:0,durationSec:10}));
 it("uses saved cut ranges and split clips, preserving the original shot reference",()=>{
  const clips=[{id:"video-2",track:"video",source:"C:/data/segment-2.mp4",sourceIn:0,start:17,duration:10},{id:"split",track:"video",source:"C:/data/segment-1.mp4",sourceIn:3,start:10,duration:7},{id:"video-0",track:"video",source:"C:/data/segment-0.mp4",sourceIn:0,start:0,duration:10}];
  const result=editorScenes(shots,true,{clips});expect(result.map(row=>row.start)).toEqual([0,10,17]);expect(result[1]).toMatchObject({shotIndex:1,sourceIn:3,duration:7});expect(result[2].start).not.toBe(20);expect(shots[1].durationSec).toBe(10);
 });
 it("does not invent timings or narration for missing/ambiguous edited media",()=>{
  expect(editorScenes(shots,true,null)).toEqual([]);expect(editorScenes(shots,true,{clips:[{id:"unknown",track:"video",source:"combined.mp4",sourceIn:2,start:3,duration:5}]})).toMatchObject([{shotIndex:null,text:"",start:3,duration:5}]);expect(editorScenes(shots,false,null).map(row=>row.start)).toEqual([0,10,20]);
 });
});
