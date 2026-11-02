# AUTONOMOUS CREATIVE STUDIO — implementation audit

Audit date: 23 October 2026 (Asia/Saigon). Source of requirements: [master prompt](AUTONOMOUS_CREATIVE_STUDIO_MASTER_PROMPT.md). This is an incremental implementation in the existing repository, not a completed master-spec release.

Read the [latest afternoon delta](IMPLEMENTATION_DELTA_2026-10-23_1400.md) and [22-scenario acceptance matrix](ACCEPTANCE_MATRIX.md) before historical measurements below. Latest selected source suite: 197 tests / 39 files pass. Images have real CUDA/UI evidence; OAuth and reviewed-delivery use mock-account contracts, not live consent or uploads.

## Preserved baseline

- Next.js 16 / React 19 UI, Node/TypeScript daemon and package boundaries remain. No FastAPI or SQLite replacement.
- JSON/JSONL storage, atomic file operations, queue idempotency, locks, backup paths and Windows DPAPI remain authoritative.
- Existing user changes and legacy data remain; no reset, migration of live data, commit or push performed by this audit.
- Tauri shell, sidecar packaging, local engine runner, Studio API and workflow UI have been added incrementally. The legacy features are not automatically proven by existence of a route/module.
- User has no genuine game media yet. Fixture footage is explicitly synthetic/test material. No platform account credentials or publication authorization have been supplied for acceptance.

## Verified evidence (scope matters)

| Check | Evidence / result | Limitation |
|---|---|---|
| Studio persistence/scheduling regression | Studio 8 + voices 3 + narration QA 3: 14/14 PASS; shared provider suite adds 7 PASS | Unit/integration file tests, not native UI or real media quality |
| English local render and deterministic cut | `evidence/acs-e2e.json`: Real MP4/SRT/thumbnail/cut; see latest durations and IDs in the evidence | Fixture; human listening NOT_REVIEWED; publication blocked |
| English sentence revision | Same `acs-e2e.json`: real Kokoro CUDA re-narration, child render; unrelated voice and rendered segment bytes preserved | English and Vietnamese fixture subset; no human listening or genuine gameplay acceptance |
| Cross-process GPU lease | `evidence/acs-gpu-lease.json`: independent process contention GPU_BUSY, crash recovery PASS, metadata cleanup PASS on Windows | Controlled test processes, not full Asset Forge coexistence acceptance |
| VieNeu setup/preflight | `evidence/acs-vieneu-setup.json`: SDK 3.8.3, torch 2.8.0+cu128, CUDA available; pinned model/codec, tokenizer/config and phonemizer checks | Real CUDA VI synthesis and fixture edit now pass; human listening remains pending |
| English TTS | `evidence/acs-english-inference.json`: Kokoro `af_heart`, 9.2s audio; latest run CUDA, measured timing in JSON | US/UK CUDA samples and local ASR comparison pass; no human listening |
| Local LLM | `evidence/acs-script-inference.json`: locally installed qwen3-vl:4b-instruct-q4_K_M | Not the proposed Qwen3.5-9B; no factual/editorial certification |
| Prior native launch | `evidence/acs-native-smoke.json`: EXE/web/worker launch and unauthenticated HTTP 401 | Authenticated native visual UI and 200/401 boundary pass; installer tracked separately |

`IMPLEMENTATION_RESUME.md` contains earlier baseline commands and interrupted build details. Do not reuse earlier build results as proof for a subsequently modified binary. Other agents may add new evidence; prefer its exact scope and timestamp.

## Reliability fixes in resumed audit

- Scheduler fingerprints actual top-level supported media bytes and editorial inputs. A due slot with unchanged inputs is skipped instead of manufacturing another copy; an explicit manual run remains possible.
- Queue identities for scheduled content survive cadence and rename/revision changes. New language variants remain separate.
- Missing/unreadable/empty sources and unsupported URL-only ingestion produce an audited skipped slot rather than repeated guaranteed-failure jobs.
- Scheduler re-reads enabled/pause/kill state under the same per-Autopilot lock used by saves.
- Stale concurrent configuration saves are rejected instead of silently overwriting a newer edit.
- Internally consistent legacy snapshot hashes are checked before schema defaults are added, then normalized in memory. A mismatched original hash is never automatically repaired.
- Narration revision creates a child with one changed segment and retains parent/settings. Worker/cache execution verification is tracked separately.

English and Vietnamese fixtures execute real narration revision and retain unrelated audio. Controlled worker crash/restart reuses byte-identical TTS, source and model pin, then completes FFmpeg export (`acs-crash-resume.json`). Production UI wizard checks pass (`acs-ui-smoke.json`). None of this certifies full editorial quality or a complete timeline editor.

## Not complete

No claim of full bilingual/editorial localization, true knowledge/product/localization factories, account-scoped auto-publishing, comprehensive model management or autonomous learning. Calendar uses day intervals, not the full timezone/quota/backlog strategy. Deduplication is exact source/editorial identity, not semantic originality. Checkpoint hashing, model weights, all dependencies, claims and rights are not yet pinned as one fully immutable quality contract.

See [workflow matrix](WORKFLOW_MATRIX.md), [known issues](KNOWN_ISSUES.md), [model compatibility](MODEL_COMPATIBILITY.md), [quality gates](QUALITY_GATES.md) and [release QA](RELEASE_QA.md).
