import { cuesForNarration, type Cue, type SpeechInterval } from "../../../packages/media/src/subtitles.js";
import { inspectCaptionCues } from "../../../packages/media/src/caption-quality.js";

type CaptionLine = { text: string; file: string; durationSec: number; audioDurationSec: number; audioSha256?:string };
type ActivityResult = { file: string; duration: number; speech: SpeechInterval[] };

function speechForLine(line: CaptionLine, activity: unknown): { speech?: SpeechInterval[]; reason: string } {
  const source = activity as { engine?: string; device?: string; results?: ActivityResult[] } | null;
  if (!source) return { reason: "VAD_NOT_MEASURED" };
  if (source.engine !== "silero-vad" || source.device !== "cpu" || !Array.isArray(source.results)) return { reason: "VAD_EVIDENCE_INVALID" };
  // Match the exact file rather than trusting result order. Production passes freshly
  // measured activity for these files, never a parent or previous attempt's artifact.
  const matches = source.results.filter(result => result?.file === line.file);
  if (matches.length !== 1) return { reason: "VAD_RESULT_MISSING_OR_DUPLICATE" };
  const result = matches[0];
  if (!Number.isFinite(result.duration) || Math.abs(result.duration - line.audioDurationSec) > 0.05 || !Array.isArray(result.speech)) return { reason: "VAD_EVIDENCE_INVALID" };
  if (!result.speech.length) return { reason: "VAD_NO_SPEECH" };
  if (!result.speech.every((s, i) => s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end > s.start && s.end <= line.audioDurationSec + 0.001 && (!i || s.start >= result.speech[i - 1].end))) return { reason: "VAD_INTERVALS_INVALID" };
  return { speech: result.speech, reason: "SPEECH_BOUND_ESTIMATE" };
}

function alignedForLine(line:CaptionLine,alignment:any,maxChars:number,offset:number){
 if(!line.audioSha256||alignment?.engine!=="wav2vec2-ctc-en"||alignment.device!=="cpu"||alignment.modelSha256!=="8aa76ab2243c81747a1f832954586bc566090c83a0ac167df6f31f0fa917d74a"||!/^en-(?:US|GB)$/.test(alignment.language??"")||!Array.isArray(alignment.results))return null;
 const matches=alignment.results.filter((result:any)=>result.file===line.file);if(matches.length!==1)return null;const result=matches[0];
 if(result.status!=="aligned"||result.audioSha256!==line.audioSha256||result.text!==line.text||!Number.isFinite(result.duration)||Math.abs(result.duration-line.audioDurationSec)>.05||!Array.isArray(result.words)||!result.words.length)return null;
 const originals=line.text.trim().split(/\s+/u);if(originals.length!==result.words.length||result.words.some((word:any,i:number)=>word.text!==originals[i]||!Number.isFinite(word.start)||!Number.isFinite(word.end)||word.start<0||word.end<=word.start||word.end>line.audioDurationSec+.001||(i>0&&word.start<result.words[i-1].end-.0001)))return null;
 const cues:Cue[]=[];let group:any[]=[];const flush=()=>{if(group.length)cues.push({start:offset+group[0].start,end:offset+group.at(-1).end,text:group.map(word=>word.text).join(" ")});group=[];};
 for(const word of result.words){if(group.length&&Array.from([...group.map(item=>item.text),word.text].join(" ")).length>maxChars)flush();group.push(word);}flush();
 return{cues,words:result.words,modelSha256:alignment.modelSha256,runnerSha256:alignment.runnerSha256};
}
export function buildStudioCaptions(lines: CaptionLine[], activity: unknown, layout: { width: number; fontSize: number; maxChars: number }, alignment?:unknown) {
  let at = 0;
  const cues: Cue[] = [];
  const timing = lines.map((line, lineIndex) => {
    const anchor = speechForLine(line, activity);
    // Fallback excludes renderer padding but makes no claim about unmeasured silence.
    const duration = Math.max(0, Math.min(line.durationSec, line.audioDurationSec));
    const aligned=alignedForLine(line,alignment,layout.maxChars,at);
    const lineCues = aligned?.cues??cuesForNarration(line.text, at, duration, layout.maxChars, anchor.speech);
    const cueStartIndex = cues.length;
    cues.push(...lineCues);
    const evidence = { lineIndex, file: line.file, offset: at, segmentDuration: line.durationSec, audioDuration: line.audioDurationSec, method: aligned?"CTC_EN_WORD_ALIGNMENT":anchor.reason, speech: anchor.speech ?? null, words:aligned?.words??null,alignmentModelSha256:aligned?.modelSha256??null,cueStartIndex, cueCount: lineCues.length };
    at += line.durationSec;
    return evidence;
  });
  const readability = inspectCaptionCues(cues, { duration: at, width: layout.width, fontSize: layout.fontSize });
  const alignedCount=timing.filter(line=>line.method==="CTC_EN_WORD_ALIGNMENT").length,allAligned=alignedCount===lines.length&&lines.length>0;
  return { cues, evidence: { schemaVersion: 1, captionTiming: allAligned?"aligned" as const:"estimated" as const, wordAlignment: allAligned?"ALIGNED_EN_CTC_NOT_HUMAN_VERIFIED":alignedCount?"PARTIALLY_ALIGNED":"UNVERIFIED", alignedLines:alignedCount,grouping: { version: 2, shortCueTargetSeconds: 0.8, characterMeasure: "Unicode code points", audioChanged: false }, timing, readability, humanReview: "REQUIRED", note: "English CTC boundaries are used only with matching audio SHA, exact wording and validated monotonic word times. Other phrase boundaries remain proportional estimates over VAD or duration; VAD does not align words. Vietnamese word alignment is unsupported. No audio was trimmed. All boundaries require listening." } };
}
