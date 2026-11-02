# Local inference engines

Production uses `runner.py` with a JSON request file. It never installs models. Hugging Face loading is offline; scripts only call a loopback LLM with redirects/proxies disabled. Narration supports `vi-VN`, `en-US`, and `en-GB`; unrecognized locales fail explicitly.

`ttsDevice` is `auto`, `cpu`, or `cuda`. An explicit unavailable CUDA request fails. CPU Kokoro does not acquire the GPU lease. The Vietnamese PyTorch path currently requires CUDA; the SDK's separate CPU ONNX backend is not installed or validated.

## Explicit setup

Use isolated `.local/engines/speech` and `.local/engines/vieneu` environments. Do not install into Asset Forge environments. Windows Python 3.11 is the tested interpreter. `requirements-vieneu.lock.txt` records the exact installed package inventory, not a portable hash-locked dependency resolution. CUDA wheels require the PyTorch cu128 index.

```
uv pip install --python .local/engines/vieneu/Scripts/python.exe vieneu==3.8.3 transformers==4.57.6 safetensors==0.8.0
uv pip install --python .local/engines/vieneu/Scripts/python.exe torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128
.local/engines/vieneu/Scripts/python.exe scripts/install-vieneu.py
```

`install-vieneu.py` pins model and codec revisions and writes per-file SHA256 manifests. `install-speech.py` pins Kokoro and downloads only two voices. Model Python source loaded through `trust_remote_code` is local source: inspect and retain the pinned codec source and license. No custom voice references are included.

## Evidence and checks

```
.local/engines/vieneu/Scripts/python.exe scripts/local-benchmark.py vietnamese
.local/engines/speech/Scripts/python.exe scripts/local-benchmark.py english
.local/engines/speech/Scripts/python.exe scripts/local-benchmark.py english-gb
.local/engines/vieneu/Scripts/python.exe scripts/test-gpu-lease.py
```

Benchmarks write truthful inference evidence to `docs/evidence` and WAVs to `.local/benchmarks`. The runner reports effective device, SDK/PyTorch versions, model/codec/voice fingerprints, elapsed time, audio duration and allocated peak VRAM. Successful synthesis is not a human quality approval. ASR round-trip and human listening remain distinct checks.

The shared OS byte lock lives at `%LOCALAPPDATA%/AssetForgeStudio/locks/gpu.lock`; ACS uses its own adjacent heartbeat metadata. Never delete or replace another application's lock to run a benchmark. `GPU_BUSY` is a retryable resource condition. The automated test uses a temporary lock, verifies two-process exclusion, kills its own owner process, then verifies acquisition and metadata cleanup. Real AFS/ACS scheduler coordination is a separate integration test.

Setup must finish before inference starts in the same environment. The integrated setup/inference paths share an OS-backed environment lock and checkpoint-store lock; do not run an external `uv pip install` while the app uses that environment.

## ASR and Voice Studio

Use a separate `.local/engines/asr` environment with `qwen-asr==0.0.6`, Transformers 4.57.6 and CUDA PyTorch 2.8.0+cu128. `requirements-asr.lock.txt` records the installed inventory. Download the pinned official 1.7B checkpoint with `scripts/install-asr.py`; production never downloads it. Run `.local/engines/asr/Scripts/python.exe scripts/asr-benchmark.py` for actual VI/US/UK round-trip evidence. The optional aligner is not installed; Vietnamese word timestamps are not claimed.

Models & Tools can inspect an explicitly selected setup folder, show detected paths, save configuration and enqueue real VI/US/UK voice auditions. The Node worker owns inference, and samples retain exact WAV SHA-256 plus checkpoint/device/timing evidence. A sample remains NOT_REVIEWED until the user listens and submits a decision. Accepted voice samples do not authorize video publication. The app checks ASR text/language when configured; the 0.15 error threshold is a heuristic and never replaces listening.

Production voice caches check weights/codec, runner and dependency/preset versions, plus actual audio bytes. A changed runtime/checkpoint blocks retries of a pinned old version instead of silently mixing voices. Create a fresh production run after an engine upgrade. The managed LLM pins its manifest digest; arbitrary external local runtimes still lack equivalent identity. Selected-profile setup is integrated through UI, but clean-machine setup and comprehensive upgrade/repair are not certified.

## Embeddings

`embedding_engine.py` is separate so adding retrieval does not change the production voice runner hash. `install-embedding.py` pins Qwen3-Embedding-0.6B weights/tokenizer/card and reuses the tested range downloader; only selected files are installed. Compatible isolated ASR Python is reused without changing packages, or configure another compatible isolated runtime. Offline AutoModel inference uses last-token pooling, 1024-dimensional L2 vectors and explicit CPU/CUDA, with no fallback. See `docs/SEMANTIC_SEARCH.md` for derived-index coverage, limitations and actual CPU evidence. Semantic similarity does not grant facts/rights/editorial approval.
