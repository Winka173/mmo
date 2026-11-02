# Narration, caption timing and voice evaluation

Implemented in the quality improvement batch on 23 October 2026. This document describes actual capability boundaries; it is not a human listening approval.

## Caption timing

- Editor → Transcript → Caption timing exposes local waveform decoding, start/end numeric fields, keyboard accessible sliders, boundary preview and timing drafts. Browser decoding is explicit and limited to 64 MiB; unsupported media remains editable with the numeric fields and video preview. No audio is uploaded.
- Saving uses the typed `set_caption_timing` operation. It validates positive duration, bounds and neighboring cue overlap, changes only caption timing, and creates a new immutable production version. Speech and factual wording remain untouched. A manually adjusted cue is labeled `manually_edited`, never automatically `aligned`.
- Optional Models & Tools profile `wav2vec2-en-align` downloads seven pinned files (377,614,626 bytes) from the [official English checkpoint](https://huggingface.co/facebook/wav2vec2-base-960h/tree/22aad52d435eb6dbaf354bdad9b0da84ce7d6156). The pinned model card declares Apache-2.0. It reuses the compatible isolated ASR runtime without changing packages and explicitly runs on CPU. It requires pinned torchaudio 2.8.0; its CTC API is deprecated upstream after that version, so runtime upgrades require a new compatibility review.
- The adapter uses local-only safetensors loading, full checkpoint and tokenizer SHA pins, exact narration audio SHA and text identity, independent acoustic decoding agreement, monotonic word bounds and conservative weak-score rejection. [CTC method documentation](https://docs.pytorch.org/audio/2.8.0/tutorials/ctc_forced_alignment_api_tutorial.html)
- Only English US/UK is enabled. Numeric written digits, unsupported characters, acoustic disagreement or weak scores remain `unknown`; the production fallback retains explicitly estimated phrases. Vietnamese word alignment is **unsupported**; VAD bounds remain estimates and manual listening is necessary. Mixed aligned/estimated runs retain overall `estimated` status.
- Forced alignment does not establish transcript accuracy, claims, licensing or publication authority. The independent decoder gate reduces forced wrong-word alignment but is not a proof or calibrated quality guarantee.

## Measured pacing

`pacing.json` uses the actual probed audio durations and resulting segment durations. The UI shows per-line rate, creative target deviation and protected numeric/negative/disclosure wording. Vietnamese whitespace syllables and English words have separate heuristic bands. Proposed duration budgets are suggestions, not automatic script changes. The system never removes required disclosures, speeds speech or invents filler merely to meet a target.

## Repeatable voice evaluation

Models & Tools → Voice auditions → Compare voice quality contains version 1 of an owner-authored fixed suite: six Vietnamese and six English cases (US or UK voice), covering rhythm, mixed names/acronyms, numbers/dates, negation, affiliate disclosures and pauses/diacritics. Generate one case or explicitly enqueue six. Each is a normal durable local audition with its own checkpoint/runtime/audio evidence.

Compare the latest sample with an earlier completed sample from a different configuration and export the JSON report. Listening acceptance remains per sample through the ordinary audition controls; ASR and matching duration do not create a human approval. Old evaluations remain associated with their original configuration and audio SHA.

## Measured evidence

`docs/evidence/acs-english-word-alignment.json` records actual offline CPU inference over existing real Kokoro speech. One plain-English line yields ten acoustic word intervals; two numeric lines stay unknown; unrelated wording over the same audio is withheld; Vietnamese is explicitly rejected. No new TTS, Qwen ASR, GPU workload or publishing occurred. Original WAV hashes are preserved. Human word-boundary ground truth and listening are unavailable, so this is an execution/guard benchmark rather than a claim of timestamp accuracy.

Reproduce using `.local/engines/asr/Scripts/python.exe scripts/alignment-benchmark.py .local/alignment-benchmark-request.json`. The request must name the intended actual audio files and matching hashes. The selected fixture and paths are machine-local; a clean Windows machine must install/apply its own runtime and model profile first.
