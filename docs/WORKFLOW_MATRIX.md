# Workflow implementation matrix

24/10/2026 delta: [RESTORE_AND_RECOVERY.md](RESTORE_AND_RECOVERY.md), 303 selected tests/64 files. Native backup restore/undo with production held, actual interrupted-restore journal rollback, and bounded automatic worker/web restart have separate evidence. Current EXE/installer acceptance remains tied to build-report hashes.

23 October 2026. Status vocabulary: VERIFIED means only the stated measured scenario; IMPLEMENTED_UNVERIFIED means code exists without sufficient acceptance evidence; BLOCKED names a missing prerequisite; NOT_IMPLEMENTED means the required behavior is absent. Partial verified substeps do not make the whole workflow VERIFIED.

Latest quality/UX update: [QUALITY_UX_IMPROVEMENTS.md](QUALITY_UX_IMPROVEMENTS.md), **298 selected tests / 63 files PASS**. Source/UI/model evidence is distinct from current-binary smoke and clean-machine acceptance. Earlier P0 remains documented separately.

| New workflow | Status | Evidence / limitation |
|---|---|---|
| Home/grouped navigation/Models tabs | VERIFIED browser subset | Actual VI/EN browser, deep links, keyboard and 480–1600px layouts; physical DPI unverified |
| Three-region editor, recoverable draft, compare | VERIFIED browser subset | Existing real speech MP4s, scene seek, local reload recovery and two-player version comparison; drafts are device-local |
| Waveform/manual caption boundaries | VERIFIED browser + real FFmpeg subset | Browser decode and immutable typed-operation child; parent/voice bytes preserved; no automatic Vietnamese alignment |
| English optional CTC alignment | VERIFIED execution subset | Ten words aligned using real CPU inference, wrong-script rejection; not human timing-accuracy acceptance |
| Pacing/fixed voice evaluation | VERIFIED measurement/UI/contracts subset | Actual audio duration, heuristic protection, six-case durable queue; human listening pending |
| App media catalog/keyframe suggestions | VERIFIED metadata/UI + real inference subset | SHA revisions and fresh matching; real Qwen suggestion has flagged shape error, never auto-accepted |
| Repetition/performance recommendations | VERIFIED bounded contracts/UI | Lexical/exact-source comparisons and data-sufficiency rules; no live campaign metrics validation |
| Brand presets/render | VERIFIED UI + actual FFmpeg subset | Font/captions/logo/CTA and pinned voices/config; existing versions preserved |

| Workflow | Current status | Working subset / remaining gap |
|---|---|---|
| Windows desktop | VERIFIED (current-machine startup/auth/close behavior) | Unicode/spaces install + portable, 200/401 auth, hide-close keeps worker, quit-close cleans process tree; clean-machine/autostart opt-in and tray click acceptance pending |
| Autopilot wizard, 7 stages | VERIFIED native/browser draft subset | Portable and installed WebView VI/EN walkthrough, reload, failed-save retention and inactive drafts pass. Does not imply content production or policy approval |
| Recurring Autopilot scheduling | VERIFIED (bounded scope) | IANA windows, limits, backlog/embargo, dry-run UI and content dedup tested; adaptive editorial director incomplete |
| Public facts feed discovery | VERIFIED (bounded RSS/Atom/UI subset) | Actual NASA offered metadata, lexical/recency selection, source article pin, cross-language recovery/dedup/no-filler. No video/enclosure download, semantic director or creator reuse permission |
| Footage source analysis | VERIFIED (owned synthetic pattern/FFmpeg/UI subset) | Source SHA/coverage, scenes/black/freeze/motion/audio, interval suggestions and child retention; no real gameplay acceptance, OCR or automatic shot replacement |
| Private ZIP export | VERIFIED (real MP4/UI subset) | Byte-bound technical revalidation, CRC/SHA/UTF-8, artifact whitelist, authenticated range/download, idempotency/temp recovery/tamper hold. Manifest remains a non-authorized draft |
| Local semantic script retrieval | VERIFIED (small CPU/CUDA/UI subset) | Qwen Embedding profile and derived root-production index/search with corpus/runtime invalidation, coverage and bounded chunks. No semantic dedup/originality certificate or broad retrieval calibration |
| One-off Create, 6 stages | VERIFIED bounded local-inference/browser subset | Actual NASA/Qwen plan stop, pinned continuation, preview/QA/private ZIP and recurring guard. P0 adds immutable line/media plan revisions, source preview, single-line audition queue with pinned config and selected-child reload. Original-speech guided stop remains absent; native draft smoke is separate |
| P0 local shot matching | VERIFIED description/fixture subset | Local Qwen embeddings match narration to owner descriptions pinned by source SHA, FFprobe bounds, measured bad intervals and repetition constraints. Missing metadata remains UNKNOWN; pixels/gameplay are not semantically inspected |
| P0 targeted repair | VERIFIED deterministic contracts/FFmpeg/UI subset | Caption regroup, audio normalization with copied video stream, and timeline encode proposals; immutable child, stale-evidence and retry-budget guards. Voice-line repair remains separately bounded; no general semantic/rights repair |
| P0 setup preflight | VERIFIED existing-Windows read-only subset | Four-step VI/EN UI, persistent GPU/disk/runtime/model evidence and actions; bootstrap downloader/resume/SHA/extraction contracts. Full official runtime download, auto FFmpeg and clean Windows VM remain unverified |
| Production stepper | IMPLEMENTED_UNVERIFIED | Persisted stage states; stage-level repair and genuine live progress not fully accepted |
| Game marketing from owner assets | BLOCKED | User has no genuine gameplay/images/logo; English fixture export verified, not gameplay acceptance |
| Vietnamese narration | VERIFIED (technical fixture scope) | Real VieNeu CUDA samples, fixture render/revision and local ASR comparison; human listening pending |
| English narration | VERIFIED (file generation only) | Real Kokoro CPU fixture plus US/UK CUDA samples and ASR comparison; human listening pending |
| Research/facts factory | VERIFIED (technical draft fixture; voice flags retained) | NASA retrieval, quote provenance, original graphics, independent VI/EN; 28.096s VI / 31.019s EN; VI voice mismatch flagged after bounded same-text repair, listening/facts/editorial approval pending |
| Product/affiliate factory | VERIFIED (sourced-product technical subset) | Actual Adafruit VI 28.073s/EN 40.003s CUDA drafts with matching ASR, dated narration/description and fresh-source preflight; static gates and invalidation contracts pass. VI caption and EN duration warnings retained; no owner/affiliate-program/marketplace/account acceptance |
| Authorized Chinese localization | BLOCKED (Mandarin full flow) | Local VI→EN and EN→VI fixtures export with ASR/dub/retiming and manifests; one Mandarin ASR demo passes; no licensed Mandarin feed/video or human translation acceptance |
| Long-to-shorts | VERIFIED (original-excerpt fixture subset) | Actual source ASR/local LLM selection/original dialogue/render; chunk timing and meaning need review; source fixture is ACS synthetic narration, not a human interview |
| Local authorized folder watcher | VERIFIED (worker/UI fixture subset) | Duplicate filenames collapse by content SHA, two schedulers create one source, partial language enqueue recovers, frozen input validated; actual owned 30s excerpt exported, UI settings persistence tested; no remote downloader/feed watcher |
| Speech activity QA | VERIFIED (CPU fixture/UI subset) | Pinned Silero selected install/apply/verify, actual VI/UK speech and silence, optional VI/EN production checks. No word alignment, automatic trimming or human listening approval |
| Backups/recovery | VERIFIED (storage/UI contract subset) | Studio metadata/media-choice backups and integrity comparison; offline restore rejects active worker and disables production/posting. No in-place UI restore, external originals/models/credentials excluded from UI backup; not a whole-machine recovery test |
| Deterministic cut | VERIFIED (multitrack fixture) | Three-second ripple across tracks, independent caption editing afterwards, real FFmpeg output and preserved parent |
| Narration sentence revision | VERIFIED (VI/EN fixtures) | Real local child render and unrelated audio preserved; human listening and genuine gameplay pending |
| Multi-track/transcript/prompt editor | VERIFIED (bounded fixture subset) | Timeline/caption/zoom/gain/title/audio import/restore and timestamped phrase-cut UI with actual shorter FFmpeg child verified. General semantic prompts, aligned words and arbitrary edited-line narration incomplete |
| Media Library | IMPLEMENTED_UNVERIFIED | Artifact listing/import subset; full licensing search/usage graph pending |
| Review Inbox | VERIFIED (contract/UI fixture) | Separate editorial/voice/facts/rights decisions tied to artifact fingerprint; defer tested, absent quotes cannot be overridden, no real human approval manufactured |
| Publishing | IMPLEMENTED_UNVERIFIED (live account blocked) | Explicit one-version YouTube, OAuth loopback/PKCE UI and reviewed-delivery policy with channel/config revisions/quotas/revocation; contracts pass, no actual login/upload. Policy retains four per-video scoped reviews; not full exception-only autopublish |
| Telegram | IMPLEMENTED_UNVERIFIED (live bot blocked) | Durable inbox/outbox, version-hash preview, scoped confirmation/auth contracts; no actual bot token/message or provider response-loss guarantee |
| Analytics/Steam attribution | IMPLEMENTED_UNVERIFIED (remote blocked) | Studio snapshots use actual confirmed remote IDs; views/likes/comments adapter, unsupported metrics null; contract tested only; Steam attribution absent |
| Model manager | IMPLEMENTED_UNVERIFIED | Catalog/config/probe, setup-folder detection and durable real voice auditions; full one-click install/upgrade/repair manager missing |
| Shared GPU lease | VERIFIED (controlled two-process test) | GPU_BUSY contention, crash recovery and metadata cleanup pass; actual Asset Forge coordination and OOM circuit breaker not claimed |

No live publishing, account changes or Asset Forge storage mutation is required to test internal development. Integration with Asset Forge must use published manifests/shared folders/versioned interface.
