/** Increment whenever deterministic scoring changes; cache raw ASR independently. */
export const VOICE_REVIEW_POLICY_VERSION = 2 as const;

/** Transparent whitespace-token edit distance. ASR is evidence, not human approval. */
export function reviewNarration(expected: string, transcription: string, requestedLocale: string, detectedLanguage: string) {
  const tokens = (value: string) => value.normalize("NFC").toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/u).filter(Boolean);
  const reference = tokens(expected), actual = tokens(transcription);
  const language = requestedLocale.startsWith("vi") ? "Vietnamese" : requestedLocale.startsWith("en") ? "English" : requestedLocale.startsWith("zh") ? "Chinese" : "Unsupported";
  if (!reference.length || !actual.length || !detectedLanguage) return { criterion: "voice.round_trip", policyVersion: VOICE_REVIEW_POLICY_VERSION, status: "unknown" as const, wordErrorRate: null, expected, transcription, detectedLanguage, languageMatch: null, reason: "Missing reference, transcription or detected language" };
  let previous = actual.map((_, j) => j + 1); previous.unshift(0);
  for (let i = 1; i <= reference.length; i++) {
    const current = [i];
    for (let j = 1; j <= actual.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (reference[i - 1] === actual[j - 1] ? 0 : 1));
    previous = current;
  }
  const wordErrorRate = previous[actual.length] / reference.length;
  const languageMatch = detectedLanguage.toLowerCase() === language.toLowerCase();
  // A low aggregate edit distance must not hide a changed price/version or a
  // dropped negation. Number words vs digits are intentionally not guessed.
  const numbers=(value:string)=>value.normalize("NFC").match(/\p{N}+(?:[.,:/-]\p{N}+)*/gu)??[];
  const expectedNumbers=numbers(expected),actualNumbers=numbers(transcription);
  const sameNumbers=JSON.stringify(expectedNumbers)===JSON.stringify(actualNumbers);
  const quantityWords=new Set("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion không một hai ba bốn tư năm lăm sáu bảy tám chín mười mươi mốt trăm nghìn ngàn triệu tỷ tỉ".split(" "));
  const expectedQuantityWords=reference.filter(word=>quantityWords.has(word)),actualQuantityWords=actual.filter(word=>quantityWords.has(word));
  const sameQuantityWords=JSON.stringify(expectedQuantityWords)===JSON.stringify(actualQuantityWords);
  // If both digit and number-word sequences change, ASR formatting may explain
  // the difference. Keep it unknown; never assume that the numeric value agrees.
  const numericStatus=sameNumbers&&sameQuantityWords?"exact" as const:!sameNumbers&&!sameQuantityWords?"format_review" as const:"mismatch" as const;
  const negations=(value:string)=>{
    const normalized=value.normalize("NFC").toLowerCase().replace(/[’']/g,"'").replace(/\b(?:cannot|\w+n't)\b/gu," not ");
    return [...normalized.matchAll(/(?<![\p{L}\p{M}])(?:no|not|never|without|không|chưa|chẳng|đừng|chớ)(?![\p{L}\p{M}])/gu)].map(match=>match[0]);
  };
  const expectedNegations=negations(expected),actualNegations=negations(transcription),negationMatch=JSON.stringify(expectedNegations)===JSON.stringify(actualNegations);
  const status=!languageMatch||wordErrorRate>0.15||numericStatus==="mismatch"||!negationMatch?"fail" as const:numericStatus==="format_review"?"unknown" as const:"pass" as const;
  return { criterion: "voice.round_trip", policyVersion: VOICE_REVIEW_POLICY_VERSION, status,
    wordErrorRate, expected, transcription, detectedLanguage, languageMatch,
    numericEvidence:{status:numericStatus,expected:expectedNumbers,actual:actualNumbers,expectedQuantityWords,actualQuantityWords},negationEvidence:{match:negationMatch,expected:expectedNegations,actual:actualNegations},
    reason: "Punctuation/case normalized; Vietnamese tokens are whitespace-separated syllables. Changed digit/number-word sequences or negations cannot pass the aggregate WER threshold. Number words vs digits remain unknown pending listening. These lexical checks do not establish semantic truth. ASR errors and names need review. Threshold 0.15 is a heuristic, not a calibrated quality guarantee." };
}
