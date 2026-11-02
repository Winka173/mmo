import {describe,it,expect} from "vitest";
import {buildNarrationPacing} from "../src/narration-pacing.js";
describe("measured narration pacing",()=>{
 it("preserves numerical, negative and disclosure lines without rewriting to fit a duration",()=>{
  const lines=[{text:"This is not a firsthand test. Price: 49.95 USD.",audioDurationSec:8,segmentDurationSec:8.3},{text:"Affiliate links may earn a commission.",audioDurationSec:4,segmentDurationSec:4.3}],before=structuredClone(lines),result=buildNarrationPacing(lines,{language:"en-US",targetSeconds:6});
  expect(result.targetStatus).toBe("over_target");expect(result.autoChanges).toBe(false);expect(result.measurements[0].protectedReasons).toEqual(["numeric_claim","negation_or_qualification"]);expect(result.measurements[1].protectedReasons).toEqual(["disclosure"]);expect(lines).toEqual(before);expect(result.measurements[0].proposedAudioBudgetSeconds).toBeCloseTo(3.6);
 });
 it("separates Vietnamese syllables from English word bands and never fabricates missing measurement",()=>{
  const result=buildNarrationPacing([{text:"Đây không phải video trải nghiệm thực tế.",audioDurationSec:2,segmentDurationSec:2.3}],{language:"vi-VN",targetSeconds:20});expect(result.targetStatus).toBe("under_target");expect(result.measurements[0].unit).toBe("whitespace_syllables");expect(result.measurements[0].protectedReasons).toContain("negation_or_qualification");expect(()=>buildNarrationPacing([{text:"A",audioDurationSec:0,segmentDurationSec:1}],{language:"en-US",targetSeconds:5})).toThrow("measured");
 });
});
