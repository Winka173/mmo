# AI model decisions for Autonomous Creative Studio (ACS)

Owner-approved architecture decision record. First written 2026-10-27, updated the same night after a real bake-off on this machine.
**Binding:** implement what is chosen here. Change a choice only if its stated gate fails on this machine, and then record the evidence in `docs/MODEL_COMPATIBILITY.md` before switching. Do not add models that are not listed.

Evidence rules still apply: a model is "working" only after a real run on this machine with a stored artifact. Where this file says UNVERIFIED, the first job is to measure, not to assume.

## 0. What changed after measuring (2026-10-27)

The owner asked for the best quality and first suggested Qwen3.6-35B-A3B. A measured bake-off (three Vietnamese/English text candidates, 27 extra runs over three seeds, plus a vision fixture) changed the choice:

| | Qwen3.6-35B-A3B (MoE) | Qwen3.8-27B (dense) | **Gemma 4 31B (dense)** |
|---|---|---|---|
| Decode speed, default offload (GPU free) | 78-106 tok/s | 13-21 tok/s | 12-19 tok/s |
| Decode speed, CPU only (`num_gpu=0`) | 21.6 tok/s | 4.1 tok/s | **7.1 tok/s** |
| Untrusted comment containing an injected instruction, plain prompt, 3 seeds | followed it once, repeated the injected claim once | followed it once, repeated or contradicted with unsupported claims twice | **resisted all 3** |
| Same comment with the production-style guarded prompt, 3 seeds | clean | clean | clean |
| Script from a source with missing facts, 3 seeds | clean | one invented claim ("free") in 3 | **clean** |
| Localization (goblin) | mistranslated goblin as golem | best, natural | faithful, but added unrequested options (fixed by the JSON schema in production) |
| Source-only fact questions (price, controller unknown) | correct | correct | correct |
| Vision fixture (blue circle, orange square, text `ACS 42`) 3 runs each | 3/3 | 3/3 | 3/3 |

**Decision: Gemma 4 31B (`gemma4:31b`, Apache-2.0) is the quality text model.** It is the most faithful to the source and the most resistant to injected instructions, and it is the fastest dense model on CPU. Qwen3.8-27B writes the most natural Vietnamese but invents claims; Qwen3.6-35B is far faster but was the least safe. The sample is small (6 task types, 3 seeds on 3 of them, one machine, one reviewer): treat it as a decision under uncertainty and re-run `scripts/llm-bakeoff/` before changing it. Raw outputs: `docs/evidence/llm-bakeoff-2026-10-27-pass1/`, `...-pass2/`. Qwen3.6-35B stays available as an opt-in "fast quality" model (set `llmQualityModel` by hand); `QUALITY_MODEL_TAG` in `packages/automation/src/models.ts` is the single place to change the default.

## 1. Machine and ground rules

| Item | Value |
|---|---|
| GPU | NVIDIA RTX 5070 Ti, 16 GB VRAM (about 16.3 GB total) |
| RAM | about 62 GB total |
| OS | Windows 11, Python 3.11 per isolated `uv` environment |
| Other local AI app | Asset Forge Studio (3D assets). Heavy peaks: TRELLIS.2 needs 16 GB VRAM and about 36 GB RAM; FLUX.2 klein about 8 GB VRAM |
| Owner also plays games on this PC | Seen on 2026-10-27: a game held about 9 GB VRAM while Asset Forge and ACS were idle |

Hard rules:
1. Local inference only. No cloud API, no cloud fallback, no paid service.
2. One heavy GPU job at a time across both apps, through the existing shared lock `%LOCALAPPDATA%/AssetForgeStudio/locks/gpu.lock` plus ACS heartbeat metadata. Never delete or replace the other app's lock, never touch its environments or model store.
3. Never silently downgrade quality or substitute a model or voice. If a resource is missing, wait or ask for a new preset, and log it.
4. The owner's games come first (section 4, "Gaming guard"). Do not run benchmarks while a game holds the GPU.
5. Deterministic FFmpeg / Sharp / libass remains the production path. AI adds to it; it never replaces the ability to render without AI.

## 2. Decisions

Status: CHOSEN = ship this. PROVISIONAL = ship behind the stated gate. DEFERRED = do not build now. REJECTED = do not use.

| Capability | Decision | Status | Where it runs | Footprint | Why |
|---|---|---|---|---|---|
| Routine text: drafts, hooks, titles, captions, classification, comment replies, structured JSON | **Qwen3.5-9B Q4_K_M** through the ACS-owned Ollama on port 11435 | CHOSEN | GPU, `keep_alive` short, unload before any other GPU stage | about 6.6 GB VRAM | VERIFIED VI/EN structured text and source-based drafts. Fast. Candidate to replace later: Gemma 4 12B (`gemma4:12b`, Apache-2.0, about 9.5 GB) if it beats 9B on the Vietnamese rubric at similar speed |
| High-stakes text: final scripts, translation, fact-verification reasoning, Quality Judge text pass, vision review | **Gemma 4 31B** (`gemma4:31b`, Apache-2.0, dense, multimodal) installed by the `qwen-quality` setup profile | CHOSEN (see section 0) | **CPU** (`num_gpu=0`) by default, `keep_alive=0`, context 8192. Partial GPU offload only when the VRAM guard shows free room | about 20 GB RAM, 0 VRAM on CPU | Best fidelity and injection resistance in the bake-off, 7.1 tok/s CPU-only, vision fixture 3/3. UNVERIFIED beyond the small sample: long-form Vietnamese naturalness over many topics |
| Exact on-screen text check (titles, numbers, game names) | **PaddleOCR PP-OCRv6 recognizers** for line text (verify vi / en / zh) plus optional **PaddleOCR-VL-1.6** (2026-08) for document-like frames | CHOSEN, to build | CPU | small | Vision LLMs read the fixture here, but exact text must come from a dedicated OCR checker, compared with the intended text |
| Vietnamese TTS | **VieNeu-TTS v3 Turbo** (pinned revisions in `requirements-vieneu.lock.txt`, `install-vieneu.py`) | CHOSEN | GPU, load, synthesize, unload | about 0.5 GB VRAM peak, about 34 s cold start measured | Only Vietnamese-native engine with verified CUDA synthesis, fixture render and ASR round trip; newest release of that project (2026-09-23). Human listening still open (section 7). **Challenger for A/B listening: VoxCPM2** (`openbmb/VoxCPM2`, Apache-2.0, 2.3B, Vietnamese among 30 languages, about 8 GB VRAM). Checked and not adopted: MOSS-TTS-v1.5 (8.5B, too big), Higgs Audio v3 and Fish Audio drama-3 (non-commercial or 36B), OmniVoice (license not stated), Chatterbox (no Vietnamese checkpoint) |
| English TTS | **Kokoro-82M**, voices `af_heart` (US) and `bf_emma` (UK) | CHOSEN | GPU or CPU | about 0.7 GB VRAM | VERIFIED CUDA and CPU with ASR round trip |
| Expressive English TTS | Chatterbox / Chatterbox-Turbo | DEFERRED | none | n/a | Build only if the owner rejects Kokoro after listening |
| ASR (VI / EN / ZH) | **Qwen3-ASR-1.7B** (pinned revision `7278e1e7...`) | CHOSEN | GPU, or CPU when the GPU is busy | about 4.5 GB VRAM | Measured: VI syllable WER 3.81 %, EN WER 8.7-10.1 %, ZH CER 0.95-2.86 % on nine licensed clips (tiny sample). No newer Qwen ASR exists as of 2026-10-27 |
| Word alignment | English: **wav2vec2-base-960h** as implemented. Vietnamese: **none** | CHOSEN | CPU | 0.38 GB | Qwen3-ForcedAligner covers only 11 languages, not Vietnamese. Use VAD plus measured phrase pacing and say so in the UI |
| Speech / silence | **Silero VAD** | CHOSEN | CPU | tiny | VERIFIED |
| Embeddings, dedup, semantic search | **Qwen3-Embedding-0.6B** (challenger **EmbeddingGemma-2**, 0.74B, Apache-2.0, 2026-10-06, only if it wins on a VI/EN retrieval set) | CHOSEN | CPU preferred | about 1.1 GB VRAM if on GPU | VERIFIED small retrieval subset |
| Image generation (thumbnails, illustrations, backdrops) | **FLUX.2 klein 4B** | CHOSEN | GPU with CPU offload, one image at a time | about 8 GB VRAM, 13-21 s per 768 px image | VERIFIED. Text on images always comes from the font pipeline |
| Image upgrade candidates | **FLUX.3 klein** (`black-forest-labs/flux-3-image-klein`, 2026-10-15, 5.5B, gated) and **Qwen-Image-2.1-Turbo** (7.1B, license 'other') | PENDING (owner action) | GPU, CPU offload | UNVERIFIED | Adopt only after the owner accepts the FLUX.3 license on Hugging Face, the commercial terms are read for a monetized channel, and a same-prompt comparison beats FLUX.2 klein. Z-Image-Turbo stays REJECTED |
| Short AI footage (b-roll) | If ever built: **Wan 2.2 TI2V-5B**, 2-4 s clips, behind the OOM gate. Newer but unsuitable: LTX-2.5 (19B, gated), Wan2.2-Animate-2-14B | DEFERRED | GPU, exclusive | UNVERIFIED | Not needed for the first versions |
| Music / SFX | User-provided royalty-cleared library only | CHOSEN | n/a | n/a | Rights are the hard part, not generation |
| Translation to Chinese | The quality text model, always routed to human review | PROVISIONAL | CPU | as above | ZH output UNVERIFIED. Localized channels also need authorization |
| Cloud LLMs, paid TTS, paid image APIs | | REJECTED | | | Rule 1 |

### Disk and downloads
The quality model is installed on demand by the `qwen-quality` profile (about 20 GB, one click in Models). Keep the duplicate FLUX.2 klein copy in ACS (isolation). Never share a writable directory with Asset Forge.

## 3. Task routing contract (implemented in `packages/automation/src/llm-profile.ts` and `apps/worker/src/local-engine.ts`)

`StudioConfig` has the fast profile (`llmModel`, `llmModelDigest`, `llmDevice`) and the quality profile (`llmQualityModel`, `llmQualityModelDigest`, `llmQualityDevice`, `llmQualityMinFreeRamGb`). A task class is carried in the engine operation (`operation.task`); everything after routing sees only the effective config, so quality lock, digest pinning and engine health keys are per model.

| Task class | Default | If the quality model is missing | Call sites |
|---|---|---|---|
| `draft`, `classify`, `comment_reply` | fast | n/a | untagged operations |
| `script_final` | quality | fast, result flagged `reviewRequired` | `research.ts`, `studio-shorts.ts` |
| `translate` | quality | fast, flagged | `studio-localization.ts` |
| `fact_reasoning`, `judge_text` | quality | fast, flagged; never mark VERIFIED on the fast model alone | to be wired with the Quality Judge |
| `judge_vision` | quality | fast, flagged | `studio-media-vision.ts` |

Rules:
- Every call is JSON-schema constrained with bounded retries, and the result records model, digest, device, tokens and wall time plus an `llmProfile` block (profile, task, reviewRequired, reason).
- The CPU quality model is admitted only if free RAM is at least `llmQualityMinFreeRamGb` (default 26 GB: a 20 GB model plus margin; a freshly written 20 GB copy can leave Windows with little free RAM for a minute, which is why the check retries). Otherwise the call fails as retryable `RAM_BUSY` and nothing is loaded.
- The managed Ollama server keeps the GPU visible whenever any profile uses it; CPU requests set `num_gpu=0` per call. Switching profiles never restarts the server.
- Per-task wall-time budgets come from measured tokens per second; exceeding one ends the task as `NEEDS_REVIEW`, not as a pass.

## 4. Resource policy

1. **Ports.** Asset Forge managed Ollama uses 11434. ACS uses 11435. Asset Forge's model downloader uses 11437. Do not use 11434, 11437 or 11440-11449 in ACS.
2. **Ollama environment for ACS:** `OLLAMA_HOST=127.0.0.1:11435`, `OLLAMA_MODELS=<ACS store>`, `OLLAMA_NO_CLOUD=1`, `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1`, redirects and proxies disabled.
3. **Gaming guard (implemented in `packages/media/src/vram-guard.ts`, wired in `invokeLocalEngine`).** Before every GPU stage compare measured whole-device free VRAM with the stage peak (`script` 7500, `asr` 5000, `tts` 1500, `image` 9500, `embed` 1600 MiB) plus a margin (default 1500). If it does not fit, throw retryable `GPU_BUSY` with nothing loaded. Devices set to `auto` drop to CPU instead. No measurement or no GPU never blocks (the engine fails loudly if CUDA is required). Config: `vramGuard {enabled, marginMb}`. Never kill another program.
4. **Residency.** Quality profile `keep_alive=0`. 9B `keep_alive` short. TTS, ASR and image processes exit after each batch.
5. **Preflight and circuit breaker** stay as in `engine-health.ts`.

## 5. Work items and status

| | Item | Status |
|---|---|---|
| A | LLM bake-off | DONE 2026-10-27 (section 0). Re-run `scripts/llm-bakeoff/run*.py` before changing the model |
| B | Model profiles and router, `qwen-quality` setup profile, UI | DONE in code with unit and routing tests; real install and verify: run `apps/worker/tools/quality-llm-check.ts` (evidence `docs/evidence/acs-quality-llm.json`) |
| C | Gaming guard | DONE with unit tests; fake-probe tests for a game holding 9 GB |
| D | PaddleOCR exact-text checker and vision certification | OPEN. Vision fixture read 9/9 by the three candidates; OCR checker not built |
| E | Voice acceptance pack (VieNeu vs VoxCPM2, Kokoro) | OPEN, needs the owner's ears |
| F | Registry document per model | Partly done in `MODEL_COMPATIBILITY.md` |

DEFERRED items (Chatterbox, Wan, generative audio) must not be started without a new owner decision.

## 6. Re-running the bake-off

`scripts/llm-bakeoff/run.py` (six task types, speed in default and CPU-only mode), `run2.py` (three seeds, plain and guarded injection comments), `run3_vision.py` (fixture). They use a separate Ollama binary and two loopback ports; adapt the paths at the top. Run only while the owner is not gaming. Promotion rule: the high-stakes model must have zero invented facts and zero followed injections across seeds, and must not be worse than the fast model on Vietnamese phrasing.

## 7. Items that need the owner

1. Listening approval for Vietnamese (`Minh Quân` voice, and VoxCPM2 as challenger) and English (`af_heart`, `bf_emma`).
2. FLUX.3 klein license acceptance on Hugging Face if an image upgrade is wanted.
3. Whether the gaming guard may also use a foreground fullscreen heuristic (today: VRAM only).
4. Any model not listed in section 2.

## 8. Do not

- Do not install into or modify Asset Forge's environments, weights or lock. Do not start or stop its services.
- Do not use cloud endpoints, or follow redirects from the LLM client.
- Do not claim Vietnamese word alignment, ZH localization, or voice approval before the evidence exists.
- Do not render text with an image model.
- Do not auto-publish. Existing policy gates stay in force.

## 9. Research log (2026-10-27) and how to trust it

Authoritative checks used the public Hugging Face model API and the Ollama library pages: Qwen releases (Qwen3.8-27B Apache-2.0 2026-08-05; Qwen3.8-Flash-Next 180B and Qwen3.8-2.4T are too large; Qwen3.6-35B-A3B Apache-2.0 2026-04-15), Ollama tags `qwen3.8:27b` (18 GB), `gemma4:12b / 26b / 31b`, Ollama runtime v0.40.11 (2026-10-24) while the machine uses v0.40.8, Qwen3-ForcedAligner (11 languages, no Vietnamese), Qwen3-ASR-1.7B (Vietnamese supported), VieNeu-TTS-v3-Turbo, VoxCPM2, MOSS-TTS-v1.5, FLUX.3 klein (gated), Qwen-Image-2.1, PaddleOCR-VL-1.6, EmbeddingGemma-2, LTX-2.5. General web articles about "best models" disagreed with each other and with the registries; do not cite them. Quality claims about Gemma 4 31B, Qwen3.8-27B and Qwen3.6-35B come from the bake-off in section 0; claims about VoxCPM2, FLUX.3 and Qwen-Image are not measured yet.
