"""English-only, offline CPU CTC alignment. Separate from voice runner fingerprints.

Method: https://docs.pytorch.org/audio/2.8.0/tutorials/ctc_forced_alignment_api_tutorial.html
The English LibriSpeech checkpoint does not support Vietnamese. Alignment is not
an independent verification that a supplied transcript is factually correct.
"""
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import sys
import time

REPO = "facebook/wav2vec2-base-960h"
REVISION = "22aad52d435eb6dbaf354bdad9b0da84ce7d6156"
WEIGHT_SHA = "8aa76ab2243c81747a1f832954586bc566090c83a0ac167df6f31f0fa917d74a"
FILE_PINS = {
    "README.md": "fc52a0adfa64e446800f9944c6cf9b90da3127aba548860ea5714516ec8c18c7",
    "config.json": "d3ec255c063d9f95057b553b19c20135b259875834a4fe9deb218a6be25b4cf3",
    "model.safetensors": WEIGHT_SHA,
    "preprocessor_config.json": "b225d617c025463b9e157e06afea8b90dc7078fc70b013c533328423e0486b4a",
    "special_tokens_map.json": "bb7068de1150661a10b55f9e4b12a0e77af8bf91f5e45e1b58afaf1d0e17f675",
    "tokenizer_config.json": "dc790594f5bc351a4311c6624f40acd95850d4aaf2a5cb3c656c9b610720b608",
    "vocab.json": "19727f8944fe6459fc3f240ae2c198395b740f6a029bd23e06656266b83bcf64",
}

def digest(file):
    with Path(file).open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()

def words_for_alignment(text):
    words = re.findall(r"\S+", text)
    normalized = []
    for original in words:
        word = original.replace("\u2019", "'").strip('.,!?;:"()[]{}')
        if not re.fullmatch(r"[A-Za-z]+(?:['-][A-Za-z]+)*", word):
            raise ValueError("ALIGNMENT_UNSUPPORTED_TEXT: use spelled English words; digits and unsupported characters need manual caption timing")
        normalized.append(word.upper().replace("-", "|"))
    if not words or len(text) > 3000:
        raise ValueError("ALIGNMENT_UNSUPPORTED_TEXT: narration line must contain 1-3000 characters")
    return words, normalized

def edit_rate(reference, actual):
    expected = re.findall(r"[A-Z]+(?:'[A-Z]+)*", reference.upper())
    observed = re.findall(r"[A-Z]+(?:'[A-Z]+)*", actual.upper())
    previous = list(range(len(observed) + 1))
    for i, word in enumerate(expected, 1):
        current = [i]
        for j, candidate in enumerate(observed, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (word != candidate)))
        previous = current
    return previous[-1] / max(1, len(expected))

def main(request):
    started = time.time()
    if request.get("language") not in ("en-US", "en-GB"):
        raise ValueError("ALIGNMENT_UNSUPPORTED_LANGUAGE: selected checkpoint supports English only; Vietnamese requires manual phrase timing")
    if request.get("device", "cpu") != "cpu":
        raise ValueError("ALIGNMENT_DEVICE: this optional adapter explicitly runs on CPU")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    config = request["config"]
    model_dir = Path(config.get("alignmentModel") or "")
    if not config.get("alignmentModel") or not model_dir.is_dir():
        raise ValueError("NEEDS_PROVIDER: install/apply the optional English alignment profile")
    manifest = json.loads((model_dir / "acs-manifest.json").read_text(encoding="utf-8"))
    if manifest.get("repo") != REPO or manifest.get("revision") != REVISION or not any(entry["path"] == "model.safetensors" and entry["sha256"] == WEIGHT_SHA for entry in manifest.get("files", [])):
        raise ValueError("QUALITY_LOCK: English alignment checkpoint pin changed")
    if {entry["path"] for entry in manifest["files"]} != set(FILE_PINS) or any(entry["sha256"] != FILE_PINS.get(entry["path"]) for entry in manifest["files"]):
        raise ValueError("QUALITY_LOCK: alignment tokenizer/config inventory differs from fixed checkpoint pins")
    if {file.name for file in model_dir.iterdir()} != set(FILE_PINS) | {"acs-manifest.json"}:
        raise ValueError("QUALITY_LOCK: unexpected alignment checkpoint sidecar; restore the pinned seven-file profile")
    for entry in manifest["files"]:
        file = model_dir / entry["path"]
        if file.is_symlink() or not file.resolve().is_relative_to(model_dir.resolve()) or file.stat().st_size != entry["bytes"] or digest(file) != entry["sha256"]:
            raise ValueError("QUALITY_LOCK: alignment checkpoint file integrity failed")
    lines = request.get("lines", [])
    if not lines or len(lines) > 60:
        raise ValueError("Alignment requires 1-60 narration lines")
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly
    import torch
    import torchaudio.functional as functional
    from transformers import Wav2Vec2Processor, Wav2Vec2ForCTC
    torch.set_num_threads(4)
    processor = Wav2Vec2Processor.from_pretrained(str(model_dir), local_files_only=True)
    model = Wav2Vec2ForCTC.from_pretrained(str(model_dir), local_files_only=True, use_safetensors=True).eval().to("cpu")
    blank = model.config.pad_token_id
    results = []
    for line in lines:
        file = str(Path(line["file"]).resolve())
        sha = digest(file)
        if line.get("audioSha256") != sha:
            raise ValueError("QUALITY_LOCK: narration audio changed before alignment")
        audio, sr = sf.read(file, dtype="float32", always_2d=True)
        duration = len(audio) / sr
        result = dict(file=file, audioSha256=sha, text=line["text"], duration=duration, words=[], status="unknown", humanReview="REQUIRED")
        try:
            originals, normalized = words_for_alignment(line["text"])
        except ValueError as error:
            result["reason"] = str(error)
            results.append(result)
            continue
        if duration <= 0 or duration > 120:
            raise ValueError("Alignment audio must be 0-120 seconds per line")
        samples = audio.mean(axis=1)
        if sr != 16000:
            divisor = math.gcd(sr, 16000)
            samples = resample_poly(samples, 16000 // divisor, sr // divisor).astype(np.float32)
        inputs = processor(samples, sampling_rate=16000, return_tensors="pt").input_values
        with torch.inference_mode():
            logits = model(inputs).logits
            log_probs = logits.log_softmax(-1)
        decoded = processor.batch_decode(logits.argmax(-1))[0]
        reference = " ".join(normalized).replace("|", " ")
        rate = edit_rate(reference, decoded)
        result.update(acousticTranscript=decoded, acousticWordErrorRate=rate)
        # Forcing unrelated words through CTC is possible. The independent greedy
        # decode must agree first; otherwise retain estimated/manual timing.
        if rate > .15:
            result["reason"] = "ACOUSTIC_TRANSCRIPT_MISMATCH: English decoder disagrees with supplied words; alignment withheld"
            results.append(result)
            continue
        vocab = processor.tokenizer.get_vocab()
        normalized_text = "|".join(normalized)
        target = torch.tensor([[vocab[letter] for letter in normalized_text]], dtype=torch.int32)
        try:
            path, scores = functional.forced_align(log_probs, target, blank=blank)
            spans = functional.merge_tokens(path[0], scores[0].exp(), blank=blank)
        except RuntimeError as error:
            result["reason"] = "CTC_ALIGNMENT_FAILED: " + str(error)
            results.append(result)
            continue
        if len(spans) != len(normalized_text) or any(span.token != vocab[letter] for span, letter in zip(spans, normalized_text)):
            raise ValueError("CTC alignment token sequence changed")
        ratio = duration / log_probs.shape[1]
        at = 0
        words = []
        for original, normalized_word in zip(originals, normalized):
            sequence = spans[at:at + len(normalized_word)]
            words.append(dict(text=original, start=round(sequence[0].start * ratio, 5), end=round(sequence[-1].end * ratio, 5), score=sum(float(span.score) for span in sequence) / len(sequence)))
            at += len(normalized_word) + 1
        if min(word["score"] for word in words) < .2:
            result["reason"] = "LOW_ACOUSTIC_SCORE: word boundary evidence requires manual timing"
            results.append(result)
            continue
        result.update(status="aligned", words=words, reason="English CTC acoustic word alignment; boundaries still require listening")
        results.append(result)
    versions = {name: importlib.metadata.version(name) for name in ("torch", "torchaudio", "transformers", "soundfile", "scipy")}
    return dict(schemaVersion=1, engine="wav2vec2-ctc-en", device="cpu", language=request["language"], modelRevision=REVISION, modelSha256=WEIGHT_SHA, runnerSha256=digest(__file__), versions=versions, seconds=time.time()-started, results=results, humanReview="REQUIRED", limitations="English only. Not calibrated against human word boundaries. Unsupported text, mismatch or weak scores remain unknown. Never proves claims, rights or editorial quality.")

if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        print(json.dumps(main(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))), ensure_ascii=False))
    except Exception as error:
        print(json.dumps(dict(error=str(error)), ensure_ascii=False))
        sys.exit(1)
