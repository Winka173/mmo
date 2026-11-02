import { describe, expect, it } from "vitest";
import { captionLines, cuesForNarration, toAss, toSrt } from "../src/subtitles.js";
import { inspectCaptionCues } from "../src/caption-quality.js";

describe("speech-bound phrase estimates", () => {
  it("excludes leading, trailing and between-cue silence with absolute line offsets", () => {
    const cues = cuesForNarration("Một câu rõ ràng. Hai câu rõ ràng.", 10, 8, 20, [{ start: 1, end: 3 }, { start: 5, end: 7 }]);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 11, end: 13, text: "Một câu rõ ràng." });
    expect(cues[1]).toEqual({ start: 15, end: 17, text: "Hai câu rõ ràng." });
    expect(toSrt(cues)).toContain("Một câu rõ ràng.");
  });
  it("keeps estimated cue order and text when a phrase crosses an internal pause", () => {
    const cues = cuesForNarration("ACS giữ nguyên chính tả và dấu Việt.", 3, 8, 70, [{ start: 1, end: 2 }, { start: 5, end: 7 }]);
    expect(cues).toEqual([{ start: 4, end: 10, text: "ACS giữ nguyên chính tả và dấu Việt." }]);
  });
  it("falls back to narration duration for missing, empty or malformed intervals", () => {
    for (const speech of [undefined, [], [{ start: 4, end: 2 }], [{ start: 0, end: 99 }]]) {
      expect(cuesForNarration("Hello.", 2, 4, 38, speech)).toEqual([{ start: 2, end: 6, text: "Hello." }]);
    }
  });
  it("groups a flashing short opening into an adjacent readable cue without deleting speech", () => {
    const text = "Go! This is a readable introduction.";
    const cues = cuesForNarration(text, 0, 5, 38);
    expect(cues).toEqual([{start:0,end:5,text}]);
    expect(inspectCaptionCues(cues,{duration:5,width:1080,fontSize:56}).status).toBe("pass");
  });
  it("rejects invalid timing and retains warnings when bounded grouping cannot repair fast narration", () => {
    for (const [start,duration,max] of [[-1,3,38],[0,0,38],[0,NaN,38],[0,3,0]]) expect(()=>cuesForNarration("Speech",start,duration,max)).toThrow(RangeError);
    const cues=cuesForNarration("This narration is far too fast for readable subtitles and needs a voice pacing review.",0,0.5,38);
    expect(cues.map(c=>c.text).join(" ")).toBe("This narration is far too fast for readable subtitles and needs a voice pacing review.");
    expect(inspectCaptionCues(cues,{duration:0.5,width:1080,fontSize:56}).status).toBe("review_required");
  });
});

describe("caption readability evidence", () => {
  const options = { duration: 10, width: 1080, fontSize: 56 };
  it("passes a readable cue and shares the renderer's two-line layout", () => {
    const cue = { start: 1, end: 4, text: "A readable caption for this frame." };
    const qa = inspectCaptionCues([cue], options);
    expect(qa.status).toBe("pass");
    expect(qa.metrics[0].lines).toEqual(captionLines(cue.text, qa.limits.estimatedCharactersPerLine));
    expect(toAss([cue], { ...options, height: 1920, marginV: 200 })).toContain(qa.metrics[0].lines.join("\\N"));
  });
  it("records measured speed and short duration without rewriting a cue", () => {
    const cues = [{ start: 1, end: 1.4, text: "A long sentence that is much too fast." }];
    const original = structuredClone(cues), qa = inspectCaptionCues(cues, options);
    expect(qa.status).toBe("review_required");
    expect(qa.findings.map(f => f.criterion)).toEqual(expect.arrayContaining(["caption.minimum_duration", "caption.reading_speed"]));
    expect(qa.metrics[0].charactersPerSecond).toBeGreaterThan(90);
    expect(cues).toEqual(original);
  });
  it("reports unbreakable overflow matching actual ASS layout", () => {
    const text = "W".repeat(70), qa = inspectCaptionCues([{ start: 0, end: 7, text }], options);
    expect(qa.findings).toContainEqual(expect.objectContaining({ criterion: "caption.layout_overflow", evidence: expect.objectContaining({ lineLengths: [70] }) }));
    expect(toAss([{ start: 0, end: 7, text }], { ...options, height: 1920, marginV: 200 })).toContain(text);
  });
  it("fails missing cues, invalid times, overlap and empty text with local evidence", () => {
    expect(inspectCaptionCues([], options).status).toBe("fail");
    const qa = inspectCaptionCues([{ start: -1, end: 2, text: "First" }, { start: 1, end: 12, text: " " }, { start: NaN, end: 3, text: "Invalid" }], options);
    expect(qa.status).toBe("fail");
    expect(qa.findings.map(f => f.criterion)).toEqual(expect.arrayContaining(["caption.bounds", "caption.overlap", "caption.empty_text"]));
    expect(qa.findings.find(f => f.criterion === "caption.overlap")?.cueIndex).toBe(1);
  });
  it("renders paths and brace content as visible literals rather than ASS commands", () => {
    const text="C:\\New folder {\\pos(0,0)}";
    const ass=toAss([{start:0,end:3,text}],{width:1080,height:1920,fontSize:56,marginV:200});
    const dialogue=ass.split("\n").find(line=>line.startsWith("Dialogue:"))!;
    expect(dialogue).toContain("C:\\\u2060New");
    expect(dialogue).toContain("｛\\\u2060pos(0,0)｝");
    expect(dialogue).not.toContain("{\\pos");
    expect(text).toBe("C:\\New folder {\\pos(0,0)}");
  });
});
