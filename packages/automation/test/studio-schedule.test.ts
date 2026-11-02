import {describe,it,expect} from "vitest";
import {ProductionSchedule,productionSlot} from "../src/studio-schedule.js";
import {StudioStore,Autopilot} from "../src/studio.js";
import {DataStore} from "@ttm/storage";
import {tmpDir} from "../../storage/test/helpers.js";
import {randomUUID} from "node:crypto";
const pilot=(over:Record<string,unknown>={})=>({id:"pilot",timezone:"Asia/Ho_Chi_Minh",languages:["vi-VN","en-US"],schedule:ProductionSchedule.parse({enabled:true,startHour:8,endHour:22,weekdays:[1,2,3,4,5],dailyLimit:4,weeklyLimit:6,maxBacklog:4,...over})});
describe("Owner production schedule",()=>{
 it("respects local weekdays/quiet hours and DST transition without assuming a fixed UTC offset",()=>{
  expect(productionSlot(pilot(),new Date("2026-10-23T00:30:00Z"),[]).allowed).toBe(false);expect(productionSlot(pilot(),new Date("2026-10-23T01:00:00Z"),[]).allowed).toBe(true);
  expect(productionSlot(pilot(),new Date("2026-10-24T03:00:00Z"),[]).allowed).toBe(false);
  const newYork={...pilot({weekdays:[0],startHour:1,endHour:2}),timezone:"America/New_York"};expect(productionSlot(newYork,new Date("2026-11-01T05:30:00Z"),[]).allowed).toBe(true);expect(productionSlot(newYork,new Date("2026-11-01T06:30:00Z"),[]).allowed).toBe(true);expect(productionSlot(newYork,new Date("2026-11-01T07:30:00Z"),[]).allowed).toBe(false);
 });
 it("counts every language output and holds a backlog / campaign embargo / expired topic",()=>{
  const now=new Date("2026-10-23T03:00:00Z"),runs=[{autopilotId:"pilot",state:"ready",trigger:"scheduled",createdAt:"2026-10-23T01:00:00Z"},{autopilotId:"pilot",state:"ready",trigger:"scheduled",createdAt:"2026-10-23T02:00:00Z"}];
  expect(productionSlot(pilot({dailyLimit:3}),now,runs).reason).toContain("Daily");expect(productionSlot(pilot({maxBacklog:2}),now,[{...runs[0],state:"needs_input"}]).reason).toContain("Backlog");expect(productionSlot(pilot({embargoUntil:"2026-10-25T00:00:00Z"}),now,[]).allowed).toBe(false);expect(productionSlot(pilot({expiresAt:"2026-10-22T00:00:00Z"}),now,[])).toMatchObject({allowed:false,nextAt:null});
 });
 it("simulates a multi-language calendar without writing jobs or changing next-run state",async()=>{
  const store=new DataStore(await tmpDir("acs-calendar-"));await store.init();const studio=new StudioStore(store),now=new Date("2026-10-23T03:00:00Z"),a=await studio.saveAutopilot(Autopilot.parse({id:randomUUID(),name:"Schedule simulation",sourceFolder:"C:/owned-not-read-in-simulation",brief:"Simulation fixture",languages:["vi-VN","en-US"],enabled:true,createdAt:now.toISOString(),updatedAt:now.toISOString(),schedule:{enabled:true,dailyLimit:2,weeklyLimit:4}}));const before=await studio.autopilot(a.id),result=await studio.calendar(14,now);expect(result.slots.length).toBeGreaterThan(0);expect(result.slots.every(s=>s.willPublish===false)).toBe(true);expect(await studio.autopilot(a.id)).toEqual(before);expect(await studio.runs()).toHaveLength(0);const queue=new (await import("../src/queue.js")).FileQueue(store);expect(await queue.list("queued")).toHaveLength(0);
 });
});
