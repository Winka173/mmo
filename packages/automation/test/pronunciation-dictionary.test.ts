import {describe,it,expect} from "vitest";
import {DataStore} from "@ttm/storage";
import {GlobalPronunciationStore,mergePronunciations,applyPronunciations,pronunciationSuggestions} from "../src/index.js";
import {tmpDir} from "../../storage/test/helpers.js";
describe("Pronunciation dictionary: global + project, suggestions from the voice check",()=>{
 it("project entries override global ones and only the spoken text changes",async()=>{
  const store=new DataStore(await tmpDir("acs-pron-"));await store.init();const g=new GlobalPronunciationStore(store);
  await g.save([{term:"Lane Keeper",spoken:"Lên Kíp-pơ",language:"vi-VN"},{term:"Steam",spoken:"Xtim",language:"vi-VN"}]);
  await expect(g.save([{term:"A",spoken:"a",language:"vi-VN"},{term:"a",spoken:"b",language:"vi-VN"}])).rejects.toThrow("Duplicate");
  const merged=mergePronunciations(await g.list(),[{term:"steam",spoken:"Sờ-tim",language:"vi-VN"}]);
  expect(applyPronunciations("Giới thiệu 'Lane Keeper' trên Steam.","vi-VN",merged)).toBe("Giới thiệu 'Lên Kíp-pơ' trên Sờ-tim.");
 });
 it("suggests the trial term the ASR misheard and ignores Vietnamese words",()=>{
  const s=pronunciationSuggestions("Giới thiệu 'Lane Keeper', tựa game thủ thành 3 làn đường do nhóm tự làm.","Giới thiệu Lính Khi Pở, tự game thủ thành ba làn đường do nhóm tự làm.","vi-VN");
  expect(s.map(x=>x.term)).toEqual(["Lane Keeper"]);expect(s[0].spoken).toMatch(/^Lên Ki/);
  expect(pronunciationSuggestions("Chơi Lane Keeper.","Chơi Lane Keeper.","vi-VN")).toEqual([]);
  expect(pronunciationSuggestions("Play Lane Keeper.","Play Lain Keeper.","en-US")).toEqual([]);
 });
});
