import {describe,it,expect} from "vitest";
import {applyPronunciations} from "../src/pronunciation.js";
describe("Speech pronunciation dictionary",()=>{
 it("replaces whole literal terms only in the requested locale and leaves source spelling intact",()=>{const source="ACS và ACSX, C++ và tên Việt.",entries=[{term:"ACS",spoken:"ây xi ét",language:"vi-VN" as const},{term:"C++",spoken:"xi cộng cộng",language:"vi-VN" as const}];expect(applyPronunciations(source,"vi-VN",entries)).toBe("ây xi ét và ACSX, xi cộng cộng và tên Việt.");expect(source).toBe("ACS và ACSX, C++ và tên Việt.");expect(applyPronunciations(source,"en-US",entries)).toBe(source);});
 it("uses longest matching terms without cascading replacement output into other entries",()=>{expect(applyPronunciations("Steam Deck and Steam", "en-US",[{term:"Steam Deck",spoken:"portable console",language:"en-US"},{term:"Steam",spoken:"Steam Deck",language:"en-US"}])).toBe("portable console and Steam Deck");});
 it("matches canonically equivalent Vietnamese input while preserving combining-mark word boundaries",()=>{
  const entries=[{term:"Việt",spoken:"Việt Nam",language:"vi-VN" as const},{term:"A",spoken:"letter a",language:"vi-VN" as const}];
  expect(applyPronunciations("Việt".normalize("NFD"),"vi-VN",entries)).toBe("Việt Nam");
  expect(applyPronunciations("A\u035c", "vi-VN",entries)).toBe("A\u035c");
 });
 it("permits explicit numeric pronunciations without changing adjacent values or source captions",()=>{
  const original="Version 2.5 has 12 levels, 120 coins and 60 FPS.";
  const spoken=applyPronunciations(original,"en-US",[{term:"2.5",spoken:"two point five",language:"en-US"},{term:"12",spoken:"twelve",language:"en-US"},{term:"FPS",spoken:"frames per second",language:"en-US"}]);
  expect(spoken).toBe("Version two point five has twelve levels, 120 coins and 60 frames per second.");
  expect(original).toBe("Version 2.5 has 12 levels, 120 coins and 60 FPS.");
  expect(applyPronunciations("12.5, 12,500, 2026-12-01 and 12.","en-US",[{term:"12",spoken:"twelve",language:"en-US"}])).toBe("12.5, 12,500, 2026-12-01 and twelve.");
 });
});
