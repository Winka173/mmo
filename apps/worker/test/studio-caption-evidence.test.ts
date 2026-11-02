import { describe, expect, it } from "vitest";
import { buildStudioCaptions } from "../src/studio-caption-evidence.js";

const layout = { width: 1080, fontSize: 56, maxChars: 38 };
const lines = [{ text: "ACS giữ dấu Việt.", file: "voice-0.wav", durationSec: 4.3, audioDurationSec: 4 }, { text: "An independent English line.", file: "voice-1.wav", durationSec: 5.3, audioDurationSec: 5 }];
const activity = { engine: "silero-vad", device: "cpu", results: [{ file: "voice-1.wav", duration: 5, speech: [{ start: 1, end: 4 }] }, { file: "voice-0.wav", duration: 4, speech: [{ start: 0.5, end: 3 }] }] };

describe("Studio caption timing provenance", () => {
  it("uses verified English acoustic word bounds only with exact matching audio and words",()=>{
    const line={text:"A quiet library.",file:"voice-0.wav",durationSec:4.3,audioDurationSec:4,audioSha256:"a".repeat(64)},alignment={engine:"wav2vec2-ctc-en",device:"cpu",language:"en-US",modelSha256:"8aa76ab2243c81747a1f832954586bc566090c83a0ac167df6f31f0fa917d74a",results:[{file:line.file,audioSha256:line.audioSha256,text:line.text,duration:4,status:"aligned",words:[{text:"A",start:.4,end:.6},{text:"quiet",start:.7,end:1.1},{text:"library.",start:1.3,end:2}]}]};
    const plan=buildStudioCaptions([line],null,layout,alignment);expect(plan.cues).toEqual([{start:.4,end:2,text:line.text}]);expect(plan.evidence.captionTiming).toBe("aligned");expect(plan.evidence.timing[0].method).toBe("CTC_EN_WORD_ALIGNMENT");
    for(const bad of [{...alignment,language:"vi-VN"},{...alignment,modelSha256:"b".repeat(64)},{...alignment,results:[{...alignment.results[0],audioSha256:"c".repeat(64)}]},{...alignment,results:[{...alignment.results[0],text:"Different text"}]},{...alignment,results:[{...alignment.results[0],words:[{text:"A",start:3,end:2}]}]}])expect(buildStudioCaptions([line],null,layout,bad).evidence.captionTiming).toBe("estimated");
    expect(buildStudioCaptions([line,{...line,file:"voice-1.wav"}],null,layout,alignment).evidence.wordAlignment).toBe("PARTIALLY_ALIGNED");
  });
  it("matches out-of-order VAD results by file, adds segment offsets and excludes render padding", () => {
    const plan = buildStudioCaptions(lines, activity, layout);
    expect(plan.cues).toEqual([{ start: 0.5, end: 3, text: lines[0].text }, { start: 5.3, end: 8.3, text: lines[1].text }]);
    expect(plan.evidence.captionTiming).toBe("estimated");
    expect(plan.evidence.wordAlignment).toBe("UNVERIFIED");
    expect(plan.evidence.timing[1].offset).toBe(4.3);
    expect(plan.evidence.timing.every(t => t.method === "SPEECH_BOUND_ESTIMATE")).toBe(true);
  });
  it("falls back to audio duration without padding if VAD was not measured", () => {
    const plan = buildStudioCaptions(lines, null, layout);
    expect(plan.cues[0].end).toBe(4);
    expect(plan.cues[1].start).toBe(4.3);
    expect(plan.cues[1].end).toBe(9.3);
    expect(plan.evidence.timing[0].method).toBe("VAD_NOT_MEASURED");
  });
  it("preserves original text and usable lines when one line has no detected speech", () => {
    const empty = structuredClone(activity); empty.results[1].speech = [];
    const plan = buildStudioCaptions(lines, empty, layout);
    expect(plan.evidence.timing.map(t => t.method)).toEqual(["VAD_NO_SPEECH", "SPEECH_BOUND_ESTIMATE"]);
    expect(plan.cues[0]).toEqual({ start: 0, end: 4, text: "ACS giữ dấu Việt." });
    expect(plan.cues[1].start).toBe(5.3);
  });
  it("never uses a different file's intervals or duplicate evidence", () => {
    const other = { ...activity, results: [activity.results[0]] };
    expect(buildStudioCaptions(lines, other, layout).evidence.timing[0].method).toBe("VAD_RESULT_MISSING_OR_DUPLICATE");
    other.results.push(activity.results[0]);
    expect(buildStudioCaptions(lines, other, layout).evidence.timing[1].method).toBe("VAD_RESULT_MISSING_OR_DUPLICATE");
  });
  it("rejects incompatible duration, unsorted intervals and unsupported VAD evidence", () => {
    const mismatched = structuredClone(activity); mismatched.results[1].duration = 8;
    expect(buildStudioCaptions(lines, mismatched, layout).evidence.timing[0].method).toBe("VAD_EVIDENCE_INVALID");
    mismatched.results[1] = { file: "voice-0.wav", duration: 4, speech: [{ start: 2, end: 3 }, { start: 1, end: 2 }] };
    expect(buildStudioCaptions(lines, mismatched, layout).evidence.timing[0].method).toBe("VAD_INTERVALS_INVALID");
    expect(buildStudioCaptions(lines, { ...activity, engine: "unknown" }, layout).evidence.timing[0].method).toBe("VAD_EVIDENCE_INVALID");
  });
});
