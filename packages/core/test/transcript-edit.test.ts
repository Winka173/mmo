import { describe, expect, it } from "vitest";
import { applyTimelineEdits, Timeline } from "../src/timeline.js";
import { mergeTranscriptRanges, planTranscriptCut, transcriptPhrases } from "../src/transcript-edit.js";

const fixture = () => Timeline.parse({ schemaVersion: 1, width: 640, height: 360, fps: 30, duration: 12, captionTiming: "estimated", createdAt: "2026-10-23T00:00:00Z", clips: [
  { id: "video", track: "video", start: 0, duration: 12, source: "original.mp4" },
  { id: "dialogue", track: "dialogue", start: 0, duration: 12, source: "original.mp4" },
  { id: "music", track: "music", start: 0, duration: 12, source: "owned.wav" },
  { id: "p1", track: "caption", start: 0, duration: 2, text: "Giữ nguyên dấu Việt." },
  { id: "p2", track: "caption", start: 2, duration: 2, text: "An incomplete qualification" },
  { id: "p3", track: "caption", start: 5, duration: 2, text: "This condition matters." },
  { id: "p4", track: "caption", start: 8, duration: 2, text: "Another complete sentence." },
  { id: "p5", track: "caption", start: 10, duration: 2, text: "The ending stays." },
] });

describe("deterministic transcript phrase cuts", () => {
  it("links exact caption text/timestamps to overlapping media and dialogue clips", () => {
    const phrases = transcriptPhrases(fixture());
    expect(phrases[0]).toEqual({ clipId: "p1", start: 0, end: 2, text: "Giữ nguyên dấu Việt.", clipRefs: ["video", "dialogue"] });
  });
  it("merges duplicates, overlapping and touching intervals without mutating input or bridging silence", () => {
    const ranges = [{ start: 5, end: 6 }, { start: 2, end: 3 }, { start: 1, end: 2 }, { start: 2, end: 4 }, { start: 5, end: 6 }], before = structuredClone(ranges);
    expect(mergeTranscriptRanges(ranges, 10)).toEqual([{ start: 1, end: 4 }, { start: 5, end: 6 }]);
    expect(ranges).toEqual(before);
    expect(mergeTranscriptRanges([{ start: 1, end: 2 }, { start: 2.00001, end: 3 }], 10)).toHaveLength(2);
  });
  it("applies disjoint selections from right to left and previews exactly the retained words/offsets", () => {
    const parent = fixture(), before = structuredClone(parent), plan = planTranscriptCut(parent, ["p2", "p4", "p2"]);
    expect(plan.operations).toEqual([{ kind: "remove_range", start: 8, end: 10 }, { kind: "remove_range", start: 2, end: 4 }]);
    expect(plan.durationAfter).toBe(8); expect(plan.removedSeconds).toBe(4);
    expect(plan.retained.map(p => [p.clipId, p.start, p.end, p.text])).toEqual([["p1", 0, 2, "Giữ nguyên dấu Việt."], ["p3", 3, 5, "This condition matters."], ["p5", 6, 8, "The ending stays."]]);
    const edited = applyTimelineEdits(parent, plan.operations);
    expect(edited.clips.filter(c => c.track === "caption").map(c => [c.id, c.start, c.start + c.duration, c.text])).toEqual(plan.retained.map(p => [p.clipId, p.start, p.end, p.text]));
    for (const track of ["video", "dialogue", "music"]) expect(edited.clips.filter(c => c.track === track).map(c => [c.start, c.duration, c.sourceIn])).toEqual([[0, 2, 0], [2, 4, 4], [6, 2, 10]]);
    expect(parent).toEqual(before); expect(edited.captionTiming).toBe("estimated");
    expect(plan.sentenceBoundaryWarnings).toContain("p2");
  });
  it("rejects empty/unknown selection and invalid or out-of-range timestamps", () => {
    expect(() => planTranscriptCut(fixture(), [])).toThrow("NO_SELECTION");
    expect(() => planTranscriptCut(fixture(), ["missing"])).toThrow("UNKNOWN_PHRASE");
    for (const range of [{ start: -1, end: 1 }, { start: 2, end: 2 }, { start: 4, end: 3 }, { start: 1, end: 13 }, { start: NaN, end: 2 }, { start: 1, end: Infinity }]) expect(() => mergeTranscriptRanges([range], 12)).toThrow("INVALID_RANGE");
    const malformed = fixture(); malformed.clips.find(c => c.id === "p3")!.start = 14;
    expect(() => planTranscriptCut(malformed, ["p2"])).toThrow("INVALID_RANGE");
  });
  it("guards whole-video deletion including a merged multi-range selection", () => {
    expect(() => mergeTranscriptRanges([{ start: 0, end: 6 }, { start: 6, end: 12 }], 12)).toThrow("WHOLE_VIDEO");
  });
  it("rejects deleting all speech even when silent gaps or renderer padding would survive", () => {
    expect(() => planTranscriptCut(fixture(), ["p1", "p2", "p3", "p4", "p5"])).toThrow("NO_RETAINED_SPEECH");
  });
  it("refuses to guess partial caption words and permits selecting the entire overlapping phrase", () => {
    const parent = fixture(); parent.clips.find(c => c.id === "p3")!.start = 3.5;
    expect(() => planTranscriptCut(parent, ["p2"])).toThrow("PARTIAL_CAPTION");
    const plan = planTranscriptCut(parent, ["p2", "p3"]);
    expect(plan.ranges).toEqual([{ start: 2, end: 5.5 }]);
    expect(plan.retained.map(p => p.text)).toEqual(["Giữ nguyên dấu Việt.", "Another complete sentence.", "The ending stays."]);
  });
  it("prevents exceeding the existing API's 50-operation limit", () => {
    expect(() => mergeTranscriptRanges(Array.from({ length: 51 }, (_, i) => ({ start: i * 2, end: i * 2 + 1 })), 104)).toThrow("TOO_MANY_CUTS");
  });
});
