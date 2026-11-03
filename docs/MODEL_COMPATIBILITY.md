# Local model compatibility and measured evidence

23 October 2026. Candidate names/licenses below are design selections, not a renewed compatibility/license audit. Inspect exact official checkpoint/revision/dependencies before installation. Only local inference is permitted; no silent cloud fallback. CPU execution must be disclosed.

| Capability | Candidate | Actual evidence / status |
|---|---|---|
| High-quality script/translation/fact reasoning/judge/vision | **Gemma 4 31B** (`gemma4:31b`, Apache-2.0) via the `qwen-quality` setup profile | BAKE-OFF 2026-10-27 (`evidence/llm-bakeoff-2026-10-27-pass1/`, `-pass2/`): CPU-only 7.1 tok/s, default offload 12-19 tok/s; zero invented facts and zero followed injected instructions in 9 seeded runs; vision fixture 3/3. Compared with Qwen3.6-35B-A3B (CPU 21.6 tok/s, one injected instruction followed, one false controller claim) and Qwen3.8-27B (CPU 4.1 tok/s, one invented claim, injection issues on plain prompts). Small sample, one reviewer, one machine. Real install/verify evidence: `evidence/acs-quality-llm.json` (see AI_MODEL_DECISIONS.md). **Production script stage run 2026-11-03** when free RAM reached 31.8 GB (Asset Forge untouched): 43 s on CPU, `evidence/gemma-window.json`; compared with Qwen3.5-9B on the same brief, Gemma kept "đợt cuối" (last wave) while Qwen wrote "màn cuối" (last level), an unsupported change. Also ran inside the packaged-app trial `evidence/trial-2026-11-03/` |
| Script/vision/translation | Qwen3.5-9B quantized | VERIFIED VI/EN structured text and source-based factory drafts on CUDA, Q4_K_M through ACS-owned Ollama 11435. Digest `56671c2ab9385f9cfcb404638e32cd62d88e3501d44822208363c010179a3c90`. Controlled vision read blue/orange correctly but `ACS 42` as `AI`: FLAGGED_REQUIRES_REVIEW, no vision/OCR certification. ZH/general translation remain unverified. |
| Vietnamese voice | VieNeu-TTS v3 Turbo | SDK 3.8.3, torch 2.8.0+cu128, CUDA RTX 5070 Ti, pinned model/codec and tokenizer/config/phonemizer preflight; real CUDA synthesis, fixture render/revision and ASR comparison verified; human listening remains pending |
| English voice | Kokoro-82M | VERIFIED US `af_heart` and UK `bf_emma` CUDA audio with real ASR round-trip; CPU fixture also verified; human listening NOT_REVIEWED |
| Expressive English voice | Chatterbox / Turbo | NOT_IMPLEMENTED |
| ASR VI/EN/Mandarin | Qwen3-ASR-1.7B | VERIFIED CUDA fixtures plus nine independently recorded licensed FLEURS validation clips on explicit CPU (`acs-asr-corpus.json`): VI syllable WER 4/105, EN WER 6/69, Mandarin CER 3/105; language 9/9. Tiny fixed sample, not general accuracy certification or Mandarin localization acceptance; companion aligner not installed and Vietnamese word timings not claimed |
| Retrieval/dedup | Qwen3-Embedding-0.6B | VERIFIED small local retrieval subset: 1024-dimensional derived script index/search, selected-profile/UI/CPU fixtures and a CUDA VI/EN probe (1.532s inference, 1149.52 MiB PyTorch peak). Revision `97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`; see SEMANTIC_SEARCH.md. No semantic duplicate-prevention/originality certification |
| Image generation/edit | FLUX.2 klein 4B or Z-Image-Turbo | FLUX text-to-image VERIFIED technical scope: CUDA CPU offload, 768-square 12.97s / 768×1344 20.66s, 7990.4 MiB PyTorch peak; selected install/apply/verify/UI/Library PNG hash pass. Square has unwanted signature-like mark, portrait inspected separately; owner NOT_REVIEWED. See IMAGE_ENGINE.md. Editing and Z-Image NOT_IMPLEMENTED |
| OCR | PaddleOCR v5 components | NOT_IMPLEMENTED in Studio slice; evaluate each recognition language |
| Speech segmentation | Silero VAD | VERIFIED local CPU speech/silence fixture inference, selected-profile installation/apply/verification through UI and optional production QA. Not word alignment or language recognition |
| Optional English word alignment | facebook/wav2vec2-base-960h | VERIFIED actual CPU CTC execution on a ten-word real Kokoro sentence; acoustic mismatch rejected and VI unsupported. Seven pinned files, revision `22aad52d435eb6dbaf354bdad9b0da84ce7d6156`, 377,614,626 bytes; profile `wav2vec2-en-align`. Uses compatible isolated ASR runtime, no cloud. Requires explicit install/apply. Human word-boundary accuracy and broad pronunciation coverage UNVERIFIED; see NARRATION_QUALITY.md |
| Optional local AI video | Supported Wan checkpoint | NOT_IMPLEMENTED; never required for deterministic edits |
| Render/caption/image tools | FFmpeg/FFprobe/libass/Sharp | Real English fixture render/decode/SRT/thumbnail; no blanket proof of NVENC or every filter |

The earlier `qwen3-vl:4b` service on 11434 belonged to Asset Forge and used CPU. ACS now has a separate copied runtime and separate model directory; it never starts/stops or modifies that application's service, environments or model store. `acs-managed-llm.json` retains the successful VI/EN text benchmark; `acs-managed-llm-latest-attempt.json` separately records a later GPU_BUSY resource wait. A pending/failed later attempt must not be represented as a successful vision test.

The new Models UI queues only the selected setup profile. Python package inventory is version-pinned and checkpoints have revision/file hashes; these inventories are not portable hash-locked resolutions. `environmentLock()` prevents setup and inference from mutating/using the same Python env concurrently across ACS worker processes. Setup in a clean Windows environment remains unverified. The GUI can inspect installed paths and run auditions; setup completion is not a human voice approval.

## Measured matrix

Silero VAD: official commit `066409f3d9db45a30d21dfcbf9147826ffdd7052`, JIT SHA256 `e1122837f4154c511485fe0b9c64455f7b929c96fbb8d79fbdb336383ebd3720`, 2,272,526 bytes. Reuses the existing isolated ASR Python runtime on **CPU**, without downloading another torch environment or acquiring the heavy GPU lease. A VI speech sample plus one second of known silence took 0.265s in one measured invocation; separate VI/UK samples took 0.243s. These are tiny fixtures, not general accuracy benchmarks. Evidence: [inference](evidence/acs-vad-inference.json), [UI](evidence/acs-vad-ui.json), [production QA](evidence/acs-vad-production.json). It detects speech intervals, not words; no automatic silence trimming or human voice approval is inferred.

| Engine | Checkpoint / voice | Mode | Time | Output | Peak VRAM | Quality review |
|---|---|---|---|---|---|---|
| kokoro | `af_heart` / en-US | cuda | 19.72s load+inference | 9.2s WAV | 720.69 MiB PyTorch allocated | Listening NOT_REVIEWED; ASR comparison recorded |
| kokoro | `bf_emma` / en-GB | cuda | 7.61s load+inference | 8.225s WAV | 725.46 MiB PyTorch allocated | Listening NOT_REVIEWED; ASR comparison recorded |
| vieneu | `Minh Quân` / vi-VN | cuda | 34.31s load+inference | 7.25s WAV | 475.1 MiB PyTorch allocated | Listening NOT_REVIEWED; ASR comparison recorded |
| Qwen3-ASR-1.7B | pinned `7278e1e70fe206f11671096ffdd38061171dd6e5` | CUDA | 12.89s for four clips | Correct language; exact normalized sample transcripts | 4480.79 MiB PyTorch allocated | No human listening; no timestamps |
| Qwen3-ASR-1.7B | same pinned checkpoint, nine independent FLEURS clips | CUDA | 31.246s runner / 59.110s process | 98.24s audio, language 9/9; VI syllable WER 3.81%, EN WER 10.14%, ZH CER 0.95% | 4480.79 MiB PyTorch allocated | Tiny validation subset; CPU figures retained separately, not general accuracy certification |
| Qwen3-Embedding-0.6B | pinned `97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3` | CUDA | 1.532s inference / 9.438s process | Three controlled VI/EN texts, 1024-dimensional vectors, expected relevance ranking | 1149.52 MiB PyTorch allocated | Small retrieval probe; actual Library UI verified separately on explicit CPU |
| Ollama local | `qwen3-vl:4b-instruct-q4_K_M` | loopback | about 7.48s | Structured scene script | not recorded | Facts/editorial not accepted |

Evidence: [English inference](evidence/acs-english-inference.json), [script inference](evidence/acs-script-inference.json), [fixture export](evidence/acs-e2e.json). These numbers are measurements of those runs, not ETAs for arbitrary content.

## Pinned Vietnamese setup and inference

[VieNeu setup](evidence/acs-vieneu-setup.json) records Transformers 4.57.6, exact downloaded file hashes and the environment inventory `engines/requirements-vieneu.lock.txt`. Model revision: `pnnbao-ump/VieNeu-TTS-v3-Turbo@61b85e3d937fbbacb387714180e8182823512523`. Codec revision: `OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano@6aa02b01e445cc585582cf0ba480bc3ea6c8dd68`. Preset voice asset SHA256: `e1f13cd2c2e0d29fdab5e15bfd7a30f3d7b768e6132bb43dd2b853f8efefdce9`.

Local tokenizer, codec configuration and Vietnamese phonemizer preflight passed; CUDA availability is measured. Initial inference was blocked by another application; later CUDA inference, real WAV, fixture export/revision and ASR comparison succeeded. Human listening remains unreviewed. Pinned README license statements and static Python search are recorded; they are not a full security/provenance audit.

## Required registry contract

For each model retain source URL, revision/hash, license/voice provenance, dependency lock, engine executable, actual supported languages/devices, memory measurements, test artifacts, limitations and verification date. Installation/catalog presence is not a working capability. Keep isolated `uv` environments. Never mutate Asset Forge dependencies or reuse its model storage for writes.

Voice acceptance requires a real VI and a real EN sample, sample file probe, listening/intelligibility review, brand/game pronunciation tests and eventual ASR comparison. Language-correct fallback is allowed only between already verified voices under explicit policy and must be logged.

## ASR runtime and exact scope

`qwen-asr==0.0.6`, Transformers 4.57.6 and PyTorch 2.8.0+cu128 run in `.local/engines/asr`. `scripts/install-asr.py` pins the official model revision and records SHA-256. See [official inference interface](https://github.com/QwenLM/Qwen3-ASR) and [checkpoint](https://huggingface.co/Qwen/Qwen3-ASR-1.7B). The optional aligner is not installed. Runtime accepts actual local WAV arrays without script context and requests no timestamps. The four measured clips are a tiny fixture set, not a population-level WER benchmark.

See `evidence/acs-asr-inference.json`, `evidence/acs-vietnamese-inference.json`, `evidence/acs-english-gb-inference.json`, and each exported `voice-review.json`. Peak numbers measure PyTorch allocation for that process, not total NVIDIA device VRAM. Cold/warm caches differ; do not turn these timings into exact ETAs.

## Independent licensed ASR evaluation

Nine fixed FLEURS validation clips at pinned revision 70bb2e84b976b7e960aa89f1c648e09c59f894dd carry CC-BY-4.0 attribution/metadata/audio hashes in `acs-asr-corpus.json`. Explicit CPU, four threads: 98.24s audio, runner 170.85s, complete process 208.83s. VI syllable WER 4/105 (3.81%), EN WER 6/69 (8.70%), Mandarin CER 3/105 (2.86%), correct language 9/9. Initial WAV float-reader failure is preserved separately; soundfile handled the offered format without changing the engine. Production GPU settings and checkpoints were untouched. This small deterministic subset is not general accent/noise coverage, TTS/translation acceptance, word alignment or calibration of the 0.15 heuristic.
