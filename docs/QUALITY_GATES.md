# Quality gates and publication boundary

23 October 2026. A playable MP4 is not a factual, rights, editorial or publication approval.

## Required separation

| Gate | Current Studio slice | Acceptance still required |
|---|---|---|
| Source | Owner declaration plus pinned file hashes | Scoped reuse/translation/dubbing/channel evidence, expiry, immutable asset version |
| Research/facts | Real guarded HTTPS retrieval, timestamp/hash, constrained actual quote catalog, bounded structure/evidence/language repair; EVIDENCE_FOUND is separate from semantic approval | Broader independent/conflicting evidence, currentness policy and calibrated entailment; owner facts review remains required |
| Script | Local/user-authored text | Language/claims/CTA/originality evaluation |
| Storyboard/media | Shot mapping; FFmpeg scene/black/freeze/motion/audio reports with pinned source SHA, scan coverage and Quality UI suggestions | Semantic visual–narration match, real gameplay authenticity, OCR, safe framing and automatic source interval selection |
| Voice | Local WAV plus Qwen3-ASR round-trip when configured | Human listening, broader pronunciation evaluation; ASR is a fallible heuristic |
| Captions | Phrase timings estimated over file-matched VAD speech where available, fallback audio duration without render padding; deterministic speed/min-duration/bounds/layout findings | Word alignment, rendered safe-zone/font inspection and listening/diacritics acceptance; estimates never count as aligned |
| Technical | Actual H.264/AAC/decode, timeline dimensions/duration; measured black/freeze/silence candidates and loudness, with unknown flags for review | Wider failure evaluation set, reading speed/safe areas and artifact checks across content families |
| Editorial | UNKNOWN | Hook, coherence, pace, brand, visual–voice relationship |
| Rights | Declaration recorded, not independently verified permission | Applicable source/destination permissions and restrictions |
| Platform eligibility | Account-specific YouTube capabilities, immutable authorization, revocation/quota checks and product fresh-source gates have contracts; live use BLOCKED | Actual credential scope/identity/account acceptance, exception-only content approval, Meta/TikTok Studio adapters |
| Approval | Review Inbox records editorial/voice/facts/rights separately, tied to output/evidence fingerprint; missing quote evidence cannot be overridden | Actual owner review; channel-specific publication authority is separate |
| Post-publish | No remote ID in fixture | Reconcile remote ID/privacy/processing state before retry |

The current Studio manual export is explicitly NOT_APPROVED for publication. Generic stage `quality: passed` describes technical checks only; `qa.json` must retain the separate UNKNOWN/BLOCKED results.

Private ZIP export verifies the exact MP4 SHA and archive/file hashes, excludes secrets/logs/models/raw originals, and records pending scoped reviews with `publicationAuthorized: false`. Legacy outputs without a byte-bound technical proof are actually decoded/revalidated before packaging. Source, rights, factual and review evidence may change after export; an archive is an immutable draft snapshot rather than lasting posting authority. Tests cover partial-temp recovery, idempotency and preserving tampered archives for diagnosis (`acs-manual-export-ui.json`).

Independent ASR measurement now includes nine FLEURS validation clips with pinned CC-BY-4.0 provenance on explicit CPU: VI syllable WER 4/105, EN WER 6/69, Mandarin CER 3/105 (`acs-asr-corpus.json`). Selection is fixed before inference; punctuation/case normalized, diacritics retained. This tiny sample does not calibrate the 0.15 voice heuristic or certify narration/translation. Production GPU config is unchanged.

## Target structured evidence

Each finding should store `criterion`, `status: pass|fail|unknown`, `evidence`, `confidence`, `severity`, `timestamp`, `modelVersion`, `relevantFiles`, `recommendedFix`. UNKNOWN never counts as PASS. Model confidence never substitutes for proof of ownership or claim truth.

## Targeted repair

- One incorrect TTS sentence: change that segment, regenerate its voice/render, recalculate dependent subtitle/timeline offsets; preserve unrelated cached shots and the original version.
- Subtitle-only edit: alignment/caption pass, no unrelated AI generation.
- Corrupt encode: re-encode from validated artifacts, not regenerate research/script/voice.
- Missing rights or account scope: hold the job. No fabricated approval or workaround.
- Exhausted budget: exception inbox, preserve artifacts and allow unrelated work to continue.

Snapshot hash normalization for older schema defaults verifies the stored representation first. It does not certify checkpoint integrity, semantic quality or authorized consent. Voice weights/codec, runner/dependency versions/preset and cached audio bytes are checked. LLM identity and a complete consent/claims reproducibility contract plus curated evaluation set remain incomplete.

Measured repair subset: `evidence/acs-e2e.json` and `evidence/acs-e2e-vi.json` record real local sentence revision while preserving unrelated voice. Captions still use estimated phrase timing. Full repair-planner/editorial acceptance and human listening remain pending.

`reviewNarration` normalizes punctuation/case while preserving Vietnamese diacritics, calculates edit distance over whitespace tokens and flags a wrong detected language or error rate above 0.15. The threshold is a heuristic, not a calibrated quality guarantee. Empty evidence stays unknown. Vietnamese tokens here are syllables, not a linguistic word tokenizer. ASR receives actual WAV data without the expected script as context. No Vietnamese word timing is claimed.
