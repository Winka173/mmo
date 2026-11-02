import {describe,it,expect} from "vitest";
import {randomUUID} from "node:crypto";
import {DataStore} from "@ttm/storage";
import {ChannelStrategyStore,StudioPublishingStore,StudioStore} from "../src/index.js";
import {tmpDir} from "../../storage/test/helpers.js";

async function setup(){
 const store=new DataStore(await tmpDir("acs-strategy-"));await store.init();
 const channel=await new StudioPublishingStore(store).saveChannel({id:randomUUID(),name:"Fixture Page",platform:"facebook_reels",expectedRemoteId:"123456789012345"});
 const pillar=randomUUID(),tips=randomUUID(),news=randomUUID(),strategies=new ChannelStrategyStore(store);
 const strategy=await strategies.save({channelId:channel.id,goal:"Help new players of a fixture game",audience:"Mobile strategy players",cta:"Follow the Page",avoid:["giveaway"],pillars:[{id:pillar,name:"Guides"}],series:[{id:tips,pillarId:pillar,name:"Tip of the week",family:"game",perWeek:2,ideas:["Tower placement basics","Slow towers vs fast towers","Giveaway announcement"]},{id:news,pillarId:pillar,name:"Patch notes",family:"custom",perWeek:1,ideas:[]}]});
 return {store,channel,strategies,strategy,tips};
}
describe("Facebook channel building: strategy -> weekly plan -> owner gate -> draft Autopilot -> metrics",()=>{
 it("plans a week from the backlog, skips avoided topics and never re-proposes an idea",async()=>{
  const {strategies,strategy}=await setup();
  const week=await strategies.generateWeek(strategy.id,"2026-11-09");
  expect(week.added.map(i=>i.idea)).toEqual(["Tower placement basics","Slow towers vs fast towers"]);
  expect(week.added[0].brief).toContain("Follow the Page");expect(week.added[0].state).toBe("proposed");
  expect(week.held).toEqual(["Tip of the week: 2/2 new ideas in backlog","Patch notes: 0/1 new ideas in backlog"].slice(1));
  expect((await strategies.generateWeek(strategy.id,"2026-11-16")).added).toHaveLength(0);
 });
 it("approval creates a disabled draft Autopilot in the series' factory; rejection creates nothing; decisions are final",async()=>{
  const {store,strategies,strategy,channel}=await setup();const {added}=await strategies.generateWeek(strategy.id,"2026-11-09");
  const ok=await strategies.decide(strategy.id,added[0].id,"approved");const pilot=(await new StudioStore(store).autopilot(ok.autopilotId!))!;
  expect(pilot).toMatchObject({family:"game",enabled:false,mode:"REVIEW_REQUIRED",targets:[channel.id],languages:["vi-VN"]});expect(pilot.brief).toContain("Tower placement basics");
  const no=await strategies.decide(strategy.id,added[1].id,"rejected","Off brand");expect(no.autopilotId).toBeNull();
  await expect(strategies.decide(strategy.id,added[0].id,"rejected")).rejects.toThrow("already decided");
  expect((await new StudioStore(store).autopilots())).toHaveLength(1);
 });
 it("reports per-series results and withholds suggestions until enough real samples exist",async()=>{
  const {strategies,strategy}=await setup();const perf=await strategies.performance(strategy.id);
  expect(perf.rows.map(r=>[r.series,r.posts,r.averageViews])).toEqual([["Tip of the week",0,null],["Patch notes",0,null]]);
  expect(perf.suggestions[0]).toMatch(/Not enough data/);
  await strategies.generateWeek(strategy.id,"2026-11-09");expect((await strategies.list()).map(s=>s.id)).toEqual([strategy.id]);
  await expect(strategies.save({...strategy,series:[{...strategy.series[0],pillarId:randomUUID()}]})).rejects.toThrow("pillar");
 });
});
