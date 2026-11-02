import {describe,it,expect} from "vitest";
import {randomUUID} from "node:crypto";
import {DataStore} from "@ttm/storage";
import {StudioStore} from "../src/index.js";
import {tmpDir} from "../../storage/test/helpers.js";

describe("Free narration edits after cuts (re-narrate the uncut version, then replay the cuts)",()=>{
 it("creates the narration child on the uncut ancestor with the cut chain to replay, and keeps every parent unchanged",async()=>{
  const store=new DataStore(await tmpDir("acs-replay-"));await store.init();const studio=new StudioStore(store),now=new Date().toISOString();
  const a=await studio.saveAutopilot({id:randomUUID(),name:"Replay fixture",createdAt:now,updatedAt:now});
  const {id}=await studio.enqueue(a,"vi-VN",randomUUID());const shots=[{text:"Câu một.",asset:"",durationSec:4,sourceStart:0,sourceDuration:null},{text:"Câu hai.",asset:"",durationSec:4,sourceStart:0,sourceDuration:null}];
  await studio.saveRun({...(await studio.run(id))!,state:"ready",shots});
  const cut1=await studio.cut(id,1,2);await studio.saveRun({...(await studio.run(cut1.id))!,state:"ready"});
  const cut2=await studio.cut(cut1.id,5,6);await studio.saveRun({...(await studio.run(cut2.id))!,state:"ready"});
  const before=JSON.stringify(await studio.run(cut2.id));
  const child=await studio.reviseNarration(cut2.id,1,"Câu hai đã sửa.");
  expect(child.parentId).toBe(id);expect(child.edit).toMatchObject({kind:"narration",index:1});
  expect(child.replay).toEqual([{kind:"cut",start:1,end:2},{kind:"cut",start:5,end:6}]);
  expect(child.shots.map(s=>s.text)).toEqual(["Câu một.","Câu hai đã sửa."]);
  expect(JSON.stringify(await studio.run(cut2.id))).toBe(before);
  // a replayed cut does not inherit the remaining replay of its parent unless passed explicitly
  await studio.saveRun({...(await studio.run(child.id))!,state:"ready",replay:[]});
  const next=await studio.cut(child.id,1,2,[{kind:"cut",start:5,end:6}]);expect(next.replay).toEqual([{kind:"cut",start:5,end:6}]);
  const plain=await studio.cut(id,0,1);expect(plain.replay).toEqual([]);
 });
});
