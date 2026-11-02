# Release QA — AUTONOMOUS CREATIVE STUDIO

## 02/11/2026 — operating-page review, Accounts & Keys, multi-platform channels, real trial (v0.2.0)

**Gates (this session).** Root and web TypeScript PASS. Next production build + Tauri Windows build (`scripts/desktop-build.ps1`) PASS for every batch, final batch rebuilt after the last source change. Full `vitest run`: 431 passed, 7 skipped, 3 failed + 1 file failed at setup — all four are the known missing `espeak-ng` binary in legacy factory render tests (`media.test.ts`, `games.test.ts`, `quality.test.ts`, `game-publish.test.ts`); no other failure. Targeted suites for every change below PASS (automation 29 files/140 tests incl. new ones).

**Native UI check** (`desktop/ui-rules-check.mjs`, packaged EXE, isolated data, worker paused, no network credentials): **27/27 PASS** on the final batch (portable EXE SHA-256 `01845C0005DEA5AE64E2643F06A09A7ECD01115E21E79D2E8A32AE555D3E7973`, installer `00078DE3D34A6E646C11F724BDE4CF50A1C7A3BDD6E15822FDCCA1A666BB10F7`, `dist/windows/`), see `evidence/acs-ui-rules-check.json`. The trial below ran on the previous batch, whose only difference is the channel-strategy plan storage fix. Covers the 9 original checks plus Autopilots, Production (8 tabs visible at the 900 px minimum width, translated states/stages/controls, tab switch), Review (empty inbox guidance), Planner (re-simulation, VI labels), Channels (no raw field names; add a Facebook Page Reels channel → "Chờ tài khoản"), Channel building (strategy → weekly plan → owner approval → disabled draft Autopilot), Accounts & Keys (all groups listed with a status, write-only save, remove, no credential input anywhere else), Library (index button feedback), English pass of the six pages, legacy A/B / budget / planner pages HTTP 200 from stored data, and no page errors (a React #418 hydration error found during review was fixed).

**Defects found and fixed in this review:** untranslated states/stage IDs/buttons on Production, Autopilots, Planner, Review, Library, Channels; Production tabs clipped at 900 px; empty Review inbox showed nothing; Planner did not re-simulate on window change; contradictory "no OAuth sign-in" text and raw `clientId/clientSecret/refreshToken` labels on Channels; packaged app chose the install folder as the model setup folder (now `%LOCALAPPDATA%/AutonomousCreativeStudio`); one-click setup of Silero VAD failed because the 10 s preflight timeout is shorter than a cold `import torch` (measured 9.6 s) → 120 s for torch probes; a quality-model RAM wait (`RAM_BUSY`) marked the run **failed** instead of waiting → now queued/retried without using attempts; the final script call was routed to the fast model → now `script_final` (quality model, flagged fallback); channel-strategy plans were stored where the strategy listing tried to parse them.

**Trial run (real, through the packaged app)** — `evidence/trial-2026-11-02/` (`trial-run.json`, `final.mp4`, `qa.json`, `voice-review.json`, `captions.srt`, `library.png`, `production.png`). Input: three synthetic FFmpeg clips labelled "FIXTURE MEDIA – NOT REAL GAMEPLAY" (the owner has no gameplay) and a fixture brief for a made-up game. One-click AI setup in Models installed/applied 7 profiles by reusing the existing local model store (no new downloads). Real stages: script by **Qwen3.5-9B on CPU** (local Ollama 11435), Vietnamese narration by **VieNeu-TTS v3 Turbo on CUDA** (shared GPU lease), ASR voice review by **Qwen3-ASR-1.7B on CUDA**, Silero VAD speech activity, deterministic captions, FFmpeg render, technical QA (`technical: true`, 18.13 s 1080×1920), thumbnail, artifact listed in Library. **Not run:** Gemma 4 31B (the binding quality model) could not be admitted — free RAM stayed 14–17 GB, below its 26 GB gate (other apps on the PC), so after 15 min the trial switched its own config to the fast model; the router flagged the script `reviewRequired`. The QA honestly flags: voice round-trip fail on line 1 (WER 0.33, the English name "Lane Keeper" heard as "Lính Khi Pở" → add a pronunciation entry), 9 caption readability findings, freeze candidates (static fixture clips), research not independent. No human listening or editorial approval; nothing posted.

**Accounts & Keys / platforms** — one page in Settings; DPAPI, write-only, status not_set/set/verified/expired/failed, read-only connection tests; Facebook Page Reels, Instagram Reels and TikTok channels use the same review → authorization → frozen bytes → identity check → upload → reconcile → metrics flow as YouTube, tested only against fake HTTP servers (`studio-platforms.test.ts`). Every live platform path is **chờ tài khoản / needs account**; no live post, login or message was made.

**Current Windows acceptance 24/10/2026:** batch **01:01:59**, verifier **01:05:03 Asia/Saigon**; `VERIFIED_MACHINE_SMOKE_NOT_FULL_RELEASE`. Installer SHA `364F1D03F14810412A5FB21324890BE7DB35ABF0D12F815A70C810266E58D62F`, portable `B470E39F5B874A402A0BE19F20C7B069220220C24B108EEF26DE64C53FE21DCA`. Full installed/portable tree: 9,858 files / 325,312,361 bytes, exact match. Native restore/undo and automatic web/worker recovery/retry exhaustion now verified against this EXE; fresh installed Unicode/spaces wizard/auth/hide-quit passes. Current evidence: RESTORE_AND_RECOVERY.md and build-report.json. Earlier “current” batch headings below are historical.

**24/10 restore/recovery checkpoint:** [RESTORE_AND_RECOVERY.md](RESTORE_AND_RECOVERY.md). 303/303 selected tests/64 files PASS; TypeScript/Next production build PASS. Actual native UI restore/undo on isolated metadata, original media preservation, held automation, actual restore process kill/journal rollback and actual bounded worker/web automatic restart are in `acs-restore-native.json`, `acs-restore-crash.json`, `acs-worker-health-ui.json`. The fourth worker fault is blocked after three restart attempts; a live foreign worker owner remains untouched. New batch 24/10 01:01:59 must match current installed/native/resource verifier in `dist/windows/build-report.json`. Older checkpoints below are historical.

**Current Windows acceptance:** batch **23/10/2026 22:54:22 Asia/Saigon**, verifier **22:56:21**, `VERIFIED_MACHINE_SMOKE_NOT_FULL_RELEASE`. Portable + fresh Unicode/spaces installed EXE: real WebView VI/EN draft wizards, authenticated 200/anonymous 401, hide/quit cleanup PASS. Forced-worker-death → normal Quit/reopen preserves exact draft, controlled live-owner startup failure preserves lock and cleans owned children. All **9,857 resource files / 325,100,012 bytes** match, tree SHA `456921ec7ec882a68a3fc61de4359645589c6373d5dd97529e51228cce8db083`. Installer SHA `5EE70C45EF35B7D9B943FC2BB672C39A1C4AB5F306AB7D7F89D2B33B07AFEEAF`. Packaged-backend improvements/UX/P0 browser smokes PASS, including actual shifted scene seek after cut. No new model inference/voice listening/public posting is implied by native draft smoke. Full report: `dist/windows/build-report.json`.

**Latest source/UX checkpoint:** [QUALITY_UX_IMPROVEMENTS.md](QUALITY_UX_IMPROVEMENTS.md), **298/298 selected tests / 63 files PASS**, root/web TypeScript and production Next build PASS. Actual browser shell/editor/media/brand/evaluation workflows, real CPU English CTC and actual branded FFmpeg render/manual timing child have separate evidence. No new TTS or human approval is implied by cached speech or queued auditions. Real Qwen keyframe output is FLAGGED for a shape error. Vietnamese word alignment, human timing/listening accuracy, physical Windows DPI, clean VM and live accounts remain unverified. The current Windows package passed its own native/installer/resource verifier as recorded above; read `dist/windows/build-report.json`. Earlier P0 checkpoints below are historical, not acceptance of this batch.

**Latest checkpoint:** [P0 acceptance](IMPLEMENTATION_DELTA_2026-10-23_P0.md), [P0 scope](P0_IMPLEMENTATION.md), [current status](IMPLEMENTATION_STATUS.md). **268 selected tests / 54 files PASS**, TypeScript/Next build PASS. Batch **21:13:54** passes portable/installed native draft wizards/auth/close, controlled startup failure and forced-worker-death followed by normal Quit/reopen. Full resource comparison/status is in `dist/windows/build-report.json`. P0 packaged-backend UI, real CPU media-description matching, English CPU/retained VI voice review and actual real-speech audio repair have separate evidence; they do not certify whole-model quality or the master prompt. Full baseline remains not all-pass: 309 passed, 2 failed assertions, 24 not executed in the older baseline; two targeted fixture tests passed separately. Clean Windows VM/full runtime bootstrap, genuine gameplay, owner listening/word alignment and live publishing are unverified. **Everything below is historical evidence and must not override this checkpoint.**

Latest packaged checkpoint: [12:22 build / 12:27 installed smoke](IMPLEMENTATION_DELTA_2026-10-23_1217.md), hash/resources verified in build-report. Native auth 200/401 and actual hide/quit cleanup pass. Voice retest timed out on another app's GPU lease; latest installed smoke explicitly skips voices, earlier successful auditions remain tied to their own binary. Source after this installer adds FLUX image/profile/UI, compact Settings and Studio Insights; these are not yet packaged/accepted. 112 selected tests / 27 files passed before image additions; 4 new TS contracts and 2 network-free Python transfer tests pass separately. Not full release acceptance. Historical entries retain original times/scope.

Updated 23 October 2026 (Asia/Saigon). **Not a production-release sign-off.** Each status below covers only its named criterion. The complete master prompt is not finished.

## Latest verified delta

- 09:54 build / 09:57 installed smoke: installer 88.39 MiB; `build-report.json` validates current portable, installer and installed resource hashes. Native auth/cleanup and installed UK/VI CUDA voice auditions + ASR pass again. PowerShell log contains a baseline-browser-mapping warning emitted as NativeCommandError by the nested wrapper; internal TypeScript/Next/Tauri/NSIS completed and produced the measured binaries. Do not describe that wrapper exit as a clean zero.
- `acs-feature-ui.json`: caption edit and owned music upload rendered as child versions through packaged worker; citations retained, scoped defer and disabled approval without acknowledgement checked; actual VI/EN CUDA model test launched through UI. Vision fixture is separately FLAGGED for wrong text recognition, not passed.
- `acs-research-e2e.json`: actual NASA HTTPS documents, exact quote catalog, VI 19.28s / EN 19.907s local draft render, narration language and technical QA. Does not certify factual entailment or editorial quality. The earlier wrong-locale sample was detected and is not acceptance evidence.
- `acs-timeline-e2e.json`: real deterministic multitrack render/cut/caption/zoom/gain/title/restore, no AI request files, original output bytes preserved.
- Latest selected suites: 47 tests passed before two setup regression tests were added and passed separately; new Telegram strict user allowlist tests (6 passed) are source changes after this installer build. Native fresh-model installation and clean-machine setup remain unverified.

- `acs-ui-smoke.json`: 12 checks PASS on production SSR: loopback pairing, seven-step Autopilot, distinct six-step Create, persisted drafts/scripts, save failure retention, VI/EN workspace, mobile layout and no runtime errors.
- `acs-native-smoke.json` and `acs-installed-smoke.json`: portable and installed Windows EXE/WebView2 rendered authenticated UI; Studio API 200 with session and 401 without. After owned native process termination, web/worker no longer existed.
- `acs-install.json`: NSIS exit 0 into `.local/installed-smoke/Ứng dụng ACS` (spaces + Unicode). Installed UI detected local tools, saved config, queued real UK/VI CUDA auditions, streamed WAV with HTTP Range 206 and recorded ASR pass. Listening decisions remain NOT_REVIEWED. Screenshot `acs-native-voices.png` captured and visually inspected.
- `acs-vietnamese-inference.json`: real VieNeu vi-VN audio on CUDA,7.25s output,34.31s load+inference,475.10MiB PyTorch peak allocated (not whole-device peak). Human listening remains NOT_REVIEWED; local ASR comparison passed on the measured samples.
- `acs-e2e.json`: English CUDA fixture, local TTS, MP4/SRT/thumbnail, 3s cut and one-segment narration revision with unrelated voice bytes preserved. Not genuine gameplay.
- VI fixture end-to-end is recorded in `acs-e2e-vi.json`. `acs-asr-inference.json` contains actual VI/US/UK transcriptions. `acs-crash-resume.json` verifies a real worker interruption and checkpoint recovery.

## Recorded commands and artifacts

- `npx --yes pnpm@10.28.0 exec vitest run packages/automation/test/studio.test.ts`: **8 tests passed**. File-backed persistence/pause/concurrent tick, exact-content novelty, stale save rejection, legacy hash integrity and parent/child narration contract.
- `docs/evidence/acs-e2e.json`: real Kokoro/FFmpeg English fixture export 19.002667s, deterministic 3-second cut 16.003s, preserved parent; sentence revision with real Kokoro CUDA and byte-identical unrelated voice; human listening NOT_REVIEWED; genuine gameplay false.
- `.local/e2e-studio/data/studio/artifacts/ff7e19ef-214e-4441-a1d5-1b2c0a93713d`: original fixture artifacts; narration child `392519f1-7124-40ab-9ae2-3878abb1275a`. Development-machine paths, not packaged end-user sample content.
- `docs/evidence/acs-native-smoke.json`: native process/web/worker started, unauthenticated HTTP 401; visual UI and pairing verified; installer evidence remains separate.
- `docs/evidence/acs-english-inference.json`: real Kokoro CUDA WAV; US/UK sample ASR checks pass, human listening remains pending.
- `docs/evidence/acs-gpu-lease.json`: VERIFIED controlled two-process contention (GPU_BUSY), crash recovery and metadata cleanup. This is not actual Asset Forge workload coexistence acceptance.
- `docs/evidence/acs-vieneu-setup.json`: CUDA torch/preflight and pinned model setup; real VI CUDA inference now exists in `acs-vietnamese-inference.json`; human listening is pending.

## Master acceptance scenarios

| # | Scenario | Status | Reason / required evidence |
|---|---|---|---|
| 1 | Installed desktop, lifecycle, loopback | VERIFIED (current-machine subset) | Installed/portable UI/auth and forced native-process cleanup pass; clean machine, tray Quit and all subprocess interruption cases remain unverified |
| 2 | Persistent 7-step wizard | VERIFIED (production browser scope) | Seven steps, save/reload and failed-save retention pass; native full wizard not separately exercised |
| 3 | Genuine game → VI 20–45s | BLOCKED | Owner has no genuine gameplay/image/logo |
| 4 | Genuine game → independent EN | BLOCKED | Same missing sources; English fixture only |
| 5 | Voices on actual machine + listening | IMPLEMENTED_UNVERIFIED | Real VI/US/UK CUDA samples and local ASR comparison; no human listening acceptance |
| 6 | Cut 00:05–00:08; preserve parent | VERIFIED (fixture only) | Real FFmpeg three-second cut evidence |
| 7 | Rewrite one VI line + selective rerender | VERIFIED (VI/EN fixtures) | Actual local narration revisions with unrelated audio preserved; no human listening sign-off |
| 8 | Facts with claims blocking | NOT_IMPLEMENTED (full flow) | Facts gate unknown; safe publication blocked |
| 9 | Sourced affiliate/price/disclosure | NOT_IMPLEMENTED (full flow) | No complete accepted product pipeline |
| 10 | Authorized Mandarin watcher → VI/EN | BLOCKED / NOT_IMPLEMENTED | No authorized source; watcher/dub acceptance absent |
| 11 | Multichannel quotas/timezone/embargo | NOT_IMPLEMENTED (full flow) | Interval cadence and duplicate suppression are a subset |
| 12 | Policy-authorized posting | BLOCKED | No authorized accounts/scopes; no fabricated approvals |
| 13 | Interrupted upload reconciliation | IMPLEMENTED_UNVERIFIED | Legacy adapter logic not a real new Studio acceptance |
| 14 | Crash/resume without artifact loss | VERIFIED (controlled fixture) | Own worker killed during real FFmpeg rendering; same queue job recovered, audio/source/pin bytes unchanged, export completed |
| 15 | GPU/OOM/corrupt checkpoint breaker | IMPLEMENTED_UNVERIFIED | Full engine breaker/batch behavior unproven |
| 16 | Two-app lease/crash recovery | VERIFIED (controlled two-process scope) | Independent process contention/crash recovery/metadata cleanup pass; actual Asset Forge integration not claimed |
| 17 | Technical PASS while rights blocks | VERIFIED (fixture boundary) | `qa.json` and fixture evidence retain blocked publication |
| 18 | Telegram preview + correct user auth | IMPLEMENTED_UNVERIFIED | Commands/auth exist; integrated preview approval pending |
| 19 | Remote-ID analytics; missing unknown | NOT_IMPLEMENTED (full flow) | No connected remote result; no invented metrics |
| 20 | Immutable ancestry/provenance/settings | IMPLEMENTED_UNVERIFIED | Parent/child tests pass; full checkpoint/consent lock incomplete |
| 21 | VI/EN onboarding/errors/wizard | IMPLEMENTED_UNVERIFIED | New shell subset; legacy localization pending |
| 22 | Evidence for every verified scenario | IMPLEMENTED_UNVERIFIED | Evidence files exist; comprehensive acceptance log incomplete |

## Release prerequisites

Build portable and installer from the same source, launch actual EXE, inspect visual screenshots, pair/authenticate, save/reopen wizard, run fixture via UI, test tray/quit and no orphan subprocesses. Verify path spaces/Unicode. Then test clean-machine dependencies and model setup. Never label a missing source, account permission, license check or unavailable local engine as success.

Update this file with later evidence at its exact scope; do not replace limitations with a blanket PASS.

## Final Windows build integrity

`dist/windows/build-report.json` is `VERIFIED_MACHINE_SMOKE_NOT_FULL_RELEASE`. Installer SHA-256 is tied to installation evidence. Installed and portable critical resources (`worker.mjs`, `server.js`, `.next/BUILD_ID`, `runner.py`) match. Executables differ in exactly three bytes: Tauri's `NSS` versus `UNK` bundle marker; all other EXE bytes are identical. Both executable variant hashes are recorded. No source mutation or rebuild is implied by this marker normalization.

The installation and native tests use a separate smoke data folder; they do not configure the owner's normal workspace or connected accounts. No public posts, external messages or fake listening approvals were produced. The test installation remains under `.local/installed-smoke`; the owner-facing installer/portable remain in `dist/windows`.

## Added checks in the latest continuation

- `voices.test.ts`: 3 PASS (durable config snapshot, explicit exact-audio review, non-mutating setup discovery).
- `voice.test.ts`: 3 PASS (missing evidence stays unknown, language mismatch, truncation, punctuation/case/diacritics).
- `providers.test.ts`: 7 PASS including rejection of remote/cloud endpoints before fetch and refusal to follow redirects; legacy shared LLM adapter is local-only too.
- `acs-asr-inference.json`: Qwen3-ASR CUDA, four actual WAVs, correct detected language and exact normalized script text on this small sample set. This is not a broad WER benchmark.
- `acs-e2e-vi.json`: latest Vietnamese fixture has ASR evidence; one sentence has a 0.0345 whitespace-token error rate, below the uncalibrated 0.15 threshold. This may be an ASR or pronunciation error and still needs listening. Unrelated voice AND rendered segment bytes stay identical after narration revision.
- `acs-crash-resume.json`: actual owned worker killed during FFmpeg render; same queue job recovered on attempt 2, pre-existing audio/source/model pin bytes unchanged, export completed.
