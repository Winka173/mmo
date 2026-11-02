"""Small independent, licensed speech probe; not a population accuracy certificate.

Select the first three distinct validation utterance IDs per locale, before inference.
Use the existing local ASR checkpoint on explicitly selected CPU by default. This
does not change production GPU settings or request an expected-text ASR context.
"""
import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
REVISION = "70bb2e84b976b7e960aa89f1c648e09c59f894dd"
CARD = "https://huggingface.co/datasets/google/fleurs"
LICENSE = "https://creativecommons.org/licenses/by/4.0/"
LANGUAGES = [("vi_vn", "Vietnamese"), ("en_us", "English"), ("cmn_hans_cn", "Chinese")]
REPORT = ROOT / "docs/evidence/acs-asr-corpus.json"


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def download(url, maximum):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in ("huggingface.co", "datasets-server.huggingface.co"):
        raise ValueError("Unexpected dataset download origin")
    with urllib.request.urlopen(url, timeout=60) as response:
        raw = response.read(maximum + 1)
    if len(raw) > maximum:
        raise ValueError("Dataset response exceeds the bounded evaluation limit")
    return raw


def tokens(text, character=False):
    text = unicodedata.normalize("NFC", text).lower()
    # Preserve letters, digits and combining marks (including Vietnamese accents).
    normalized = "".join(c if unicodedata.category(c)[0] in "LNM" else " " for c in text)
    return list("".join(normalized.split())) if character else normalized.split()


def distance(reference, actual):
    previous = list(range(len(actual) + 1))
    for i, expected in enumerate(reference, 1):
        current = [i]
        for j, observed in enumerate(actual, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (expected != observed)))
        previous = current
    return previous[-1]


def write_report(report):
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def prepare(folder):
    card_url = f"https://huggingface.co/datasets/google/fleurs/resolve/{REVISION}/README.md"
    card = download(card_url, 1024 * 1024)
    if b"cc-by-4.0" not in card[:1200]:
        raise ValueError("Pinned dataset card does not declare expected license")
    (folder / "FLEURS-README.md").write_bytes(card)
    samples = []
    for locale, language in LANGUAGES:
        metadata_url = f"https://huggingface.co/datasets/google/fleurs/resolve/{REVISION}/data/{locale}/dev.tsv"
        metadata = download(metadata_url, 2 * 1024 * 1024)
        (folder / f"{locale}.dev.tsv").write_bytes(metadata)
        references = {row[1]: row for row in csv.reader(io.StringIO(metadata.decode("utf-8")), delimiter="\t")}
        query = urllib.parse.urlencode(dict(dataset="google/fleurs", config=locale, split="validation", offset=0, length=12))
        rows = json.loads(download("https://datasets-server.huggingface.co/rows?" + query, 1024 * 1024))["rows"]
        selected, ids = [], set()
        for record in rows:
            row = record["row"]
            if row["id"] in ids:
                continue
            ids.add(row["id"])
            selected.append(record)
            if len(selected) == 3:
                break
        if len(selected) != 3:
            raise ValueError("Not enough distinct initial validation IDs; do not substitute selected successes")
        for record in selected:
            row = record["row"]
            name = Path(row["path"]).name
            reference = references.get(name)
            if not reference or int(reference[0]) != row["id"] or reference[2] != row["raw_transcription"]:
                raise ValueError("Viewer row does not match the pinned original metadata")
            source = row["audio"][0]["src"]
            parsed = urllib.parse.urlsplit(source)
            expected_path = f"/cached-assets/google/fleurs/--/{REVISION}/--/{locale}/validation/{record['row_idx']}/audio/audio.wav"
            if parsed.hostname != "datasets-server.huggingface.co" or parsed.path != expected_path:
                raise ValueError("Audio URL is not bound to the pinned dataset revision and selected row")
            raw = download(source, 8 * 1024 * 1024)
            audio = folder / f"{locale}-{record['row_idx']}-{name}"
            audio.write_bytes(raw)
            decoded = sf.info(io.BytesIO(raw))
            rate, frames, channels = decoded.samplerate, decoded.frames, decoded.channels
            if rate != 16000 or channels != 1 or frames != row["num_samples"] or not 0 < frames / rate <= 40:
                raise ValueError("Unexpected dataset audio format, duration or sample count")
            samples.append(dict(locale=locale, expectedLanguage=language, rowIndex=record["row_idx"], utteranceId=row["id"],
                file=str(audio), sha256=digest(raw), seconds=frames / rate, sampleRate=rate,
                reference=row["raw_transcription"], datasetTranscription=row["transcription"],
                metadataUrl=metadata_url, metadataSha256=digest(metadata),
                audioSource=urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))))
    (folder / "ATTRIBUTION.txt").write_text(
        f"FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech.\n"
        f"Google and FLEURS contributors; dataset: {CARD}\nRevision: {REVISION}\n"
        f"License: Creative Commons Attribution 4.0 International, {LICENSE}\n"
        "Selected first three distinct validation IDs for Vietnamese, English and Mandarin.\n"
        "Viewer WAV samples retained as offered; no clipping, dubbing, cloning or public posting.\n"
        "References/ASR transcripts normalized only for evaluation; raw text is preserved.\n",
        encoding="utf-8")
    return samples, dict(card=card_url, cardSha256=digest(card), license="CC-BY-4.0", licenseUrl=LICENSE)


def main():
    global REPORT
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if args.device == "cuda":
        REPORT = ROOT / "docs/evidence/acs-asr-corpus-cuda.json"
    if not 1 <= args.threads <= 8:
        raise ValueError("CPU thread count must be 1..8")
    folder = ROOT / ".local/benchmarks/fleurs" / str(int(time.time() * 1000))
    folder.mkdir(parents=True)
    report = dict(status="PREPARING", at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), folder=str(folder),
        requestedDevice=args.device, cpuThreads=args.threads, dataset="google/fleurs", revision=REVISION,
        selection="First three distinct utterance IDs in first 12 validation rows per locale; fixed before inference",
        scope="Nine speech clips, not a representative WER corpus, translation/TTS acceptance, word alignment or human review",
        expectedTextSentToASR=False, productionConfigChanged=False, humanReview="NOT_REVIEWED", publicPosting=False)
    write_report(report)
    try:
        samples, license_record = prepare(folder)
        report.update(status="INFERENCE_RUNNING", samples=samples, provenance=license_record)
        write_report(report)
        request = dict(op="asr", config=dict(asrModel=str(ROOT / ".local/models/qwen3-asr"), asrDevice=args.device),
            audio=[sample["file"] for sample in samples])
        request_path = folder / "request.json"
        request_path.write_text(json.dumps(request), encoding="utf-8")
        env = {**os.environ, "OMP_NUM_THREADS": str(args.threads), "MKL_NUM_THREADS": str(args.threads),
               "OPENBLAS_NUM_THREADS": str(args.threads), "PYTHONIOENCODING": "utf-8", "HF_HUB_OFFLINE": "1"}
        started = time.monotonic()
        result = subprocess.run([str(ROOT / ".local/engines/asr/Scripts/python.exe"), str(ROOT / "engines/runner.py"), str(request_path)],
            capture_output=True, text=True, encoding="utf-8", env=env, timeout=900)
        (folder / "runtime.log").write_text(result.stderr, encoding="utf-8")
        report.update(exitCode=result.returncode, wallSeconds=time.monotonic() - started)
        inference = json.loads(result.stdout.strip().splitlines()[-1])
        report["inference"] = inference
        if result.returncode or inference.get("error"):
            raise RuntimeError(inference.get("error", "ASR process failed"))
        if inference.get("device") != args.device or len(inference.get("results", [])) != len(samples):
            raise ValueError("Runtime did not honor requested execution device or complete all samples")
        summary = {}
        for sample, actual in zip(samples, inference["results"]):
            if actual["file"] != sample["file"] or digest(Path(sample["file"]).read_bytes()) != sample["sha256"]:
                raise ValueError("Audio identity changed across evaluation")
            character = sample["locale"] == "cmn_hans_cn"
            reference, observed = tokens(sample["reference"], character), tokens(actual["text"], character)
            count = distance(reference, observed)
            sample.update(transcription=actual["text"], detectedLanguage=actual["language"],
                languageMatch=actual["language"] == sample["expectedLanguage"], metric="CER" if character else "WER",
                referenceUnits=len(reference), errors=count, errorRate=count / len(reference))
            totals = summary.setdefault(sample["locale"], dict(metric=sample["metric"], clips=0, seconds=0, errors=0, referenceUnits=0, languageMatches=0))
            for key, value in dict(clips=1, seconds=sample["seconds"], errors=count, referenceUnits=len(reference), languageMatches=int(sample["languageMatch"])).items():
                totals[key] += value
        for totals in summary.values():
            totals["errorRate"] = totals["errors"] / totals["referenceUnits"]
        report.update(status="VERIFIED_SMALL_LICENSED_ASR_EVALUATION_NOT_QUALITY_CERTIFICATION", summary=summary,
            normalization="NFC + lowercase; punctuation removed; diacritics retained. VI WER uses whitespace-separated syllables; ZH CER includes letters/digits in mixed names.")
        write_report(report)
        print(json.dumps({key: report[key] for key in ("status", "requestedDevice", "wallSeconds", "summary")}, ensure_ascii=True))
        return 0
    except Exception as error:
        # Do not log offered signed asset URLs or exception response credentials.
        report.update(status="BLOCKED_OR_FAILED", errorType=type(error).__name__)
        write_report(report)
        print(json.dumps(dict(status=report["status"], errorType=type(error).__name__, folder=str(folder))))
        raise


if __name__ == "__main__":
    sys.exit(main())
