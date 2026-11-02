export type NarrationMeasurement={text:string;audioDurationSec:number;segmentDurationSec:number};
/** Editorial hints from measured speech; never a request to change claims or a quality approval. */
export function buildNarrationPacing(lines:NarrationMeasurement[],options:{language:string;targetSeconds:number;protectedPhrases?:string[]}){
 if(!Number.isFinite(options.targetSeconds)||options.targetSeconds<=0)throw new Error("A positive target duration is required");
 if(!lines.length||lines.some(line=>!Number.isFinite(line.audioDurationSec)||line.audioDurationSec<=0||!Number.isFinite(line.segmentDurationSec)||line.segmentDurationSec<line.audioDurationSec))throw new Error("Pacing requires actual positive measured audio and segment durations");
 const language=options.language.startsWith("vi")?"vi":options.language.startsWith("en")?"en":"unsupported";
 const totalAudio=lines.reduce((s,line)=>s+line.audioDurationSec,0),totalSegments=lines.reduce((s,line)=>s+line.segmentDurationSec,0);
 // Locale bands are labeled heuristics, not calibrated naturalness thresholds.
 const band=language==="vi"?[2.5,5]:language==="en"?[1.8,3.3]:null;
 const measurements=lines.map((line,index)=>{
  const units=line.text.trim().split(/\s+/u).filter(Boolean).length,unitsPerSecond=units/line.audioDurationSec;
  const protectedReasons:string[]=[];
  if(/\p{N}/u.test(line.text))protectedReasons.push("numeric_claim");
  if(/(?<![\p{L}\p{M}])(?:not|no|never|without|cannot|không|chưa|chẳng|đừng)(?![\p{L}\p{M}])/iu.test(line.text))protectedReasons.push("negation_or_qualification");
  if(/affiliate|commission|sponsored|advertis|tiếp thị liên kết|hoa hồng|tài trợ|quảng cáo/iu.test(line.text))protectedReasons.push("disclosure");
  if(options.protectedPhrases?.some(phrase=>phrase.trim()&&line.text.normalize("NFC").includes(phrase.normalize("NFC"))))protectedReasons.push("owner_protected_phrase");
  return{index,text:line.text,audioSeconds:line.audioDurationSec,segmentSeconds:line.segmentDurationSec,units,unitsPerSecond,unit:language==="vi"?"whitespace_syllables":language==="en"?"words":"whitespace_tokens",pace:!band?"unknown":unitsPerSecond>band[1]?"fast":unitsPerSecond<band[0]?"slow":"within_heuristic_range",protectedReasons,proposedAudioBudgetSeconds:Math.max(.1,line.audioDurationSec/totalAudio*Math.max(.1,options.targetSeconds-(totalSegments-totalAudio))),suggestion:protectedReasons.length?"Review delivery or remove repetition elsewhere; retain exact claims, numbers, qualifications and disclosures":"Review optional connective wording and repetition after listening; no automatic wording change"};
 });
 const ratio=totalSegments/options.targetSeconds,targetStatus=ratio>1.3?"over_target":ratio<.7?"under_target":"within_heuristic_tolerance";
 return{schemaVersion:1,language:options.language,measurement:"probed_audio_duration",targetSeconds:options.targetSeconds,actualAudioSeconds:totalAudio,actualTimelineSeconds:totalSegments,ratio,targetStatus,unitsPerSecondBand:band,measurements,autoChanges:false,willPublish:false,humanReview:"REQUIRED",recommendation:targetStatus==="over_target"?"Shorten reviewed repetition or select a longer target; never speed speech or remove required statements automatically":targetStatus==="under_target"?"Choose a shorter target or add independently supported useful context; never insert filler or invented facts":"Listen for rhythm, pauses and pronunciation; matching a target is not evidence of editorial quality",limitations:"Whitespace-based pace bands and +/-30% target tolerance are editorial heuristics, not validated listening scores. Vietnamese syllables and English words must not be compared directly."};
}
