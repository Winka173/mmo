"""Optional English CTC checkpoint. Reuse existing ASR Python without package mutation."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import urllib.request
from alignment_engine import FILE_PINS

REPO = "facebook/wav2vec2-base-960h"
REVISION = "22aad52d435eb6dbaf354bdad9b0da84ce7d6156"
WEIGHT_SHA = "8aa76ab2243c81747a1f832954586bc566090c83a0ac167df6f31f0fa917d74a"
NAMES = {"README.md", "config.json", "preprocessor_config.json", "special_tokens_map.json", "tokenizer_config.json", "vocab.json", "model.safetensors"}

def main():
    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
    models = Path(request["models"]).resolve()
    destination = models / "wav2vec2-en-align"
    destination.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink() or not destination.resolve().is_relative_to(models) or any(token in str(destination.resolve()).lower() for token in ("asset-forge", "assetforgestudio")):
        raise ValueError("Alignment checkpoint must remain in ACS-owned storage")
    spec = importlib.util.spec_from_file_location("acs_alignment_download", Path(__file__).with_name("install-image.py"))
    downloader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(downloader)
    downloader.REPO, downloader.REVISION, downloader.DEST = REPO, REVISION, destination
    with urllib.request.urlopen(f"https://huggingface.co/api/models/{REPO}/revision/{REVISION}?blobs=true", timeout=30) as response:
        metadata = json.load(response)
    files = [entry for entry in metadata["siblings"] if entry["rfilename"] in NAMES]
    if {entry["rfilename"] for entry in files} != NAMES or next(entry for entry in files if entry["rfilename"] == "model.safetensors")["lfs"]["sha256"] != WEIGHT_SHA:
        raise ValueError("Selected official checkpoint differs from its pinned inventory")
    records = []
    for entry in files:
        downloader.download(entry)
        file = destination / entry["rfilename"]
        with file.open("rb") as handle:
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
        if file.is_symlink() or not file.resolve().is_relative_to(destination.resolve()) or file.stat().st_size != entry["size"] or entry.get("lfs", {}).get("sha256", digest) != digest or digest != FILE_PINS[entry["rfilename"]]:
            raise ValueError("Alignment checkpoint file integrity failed")
        records.append(dict(path=entry["rfilename"], bytes=file.stat().st_size, sha256=digest))
    if "license: apache-2.0" not in (destination / "README.md").read_text(encoding="utf-8")[:1000].lower():
        raise ValueError("Pinned model card does not declare the expected license")
    manifest = dict(repo=REPO, revision=REVISION, source=f"https://huggingface.co/{REPO}/tree/{REVISION}", license="Apache-2.0 as declared by pinned model card", languages=["en"], files=records, inference="NOT_VERIFIED")
    temporary = destination / "acs-manifest.json.partial"
    temporary.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    os.replace(temporary, destination / "acs-manifest.json")
    print(json.dumps(dict(status="INSTALLED_NOT_INFERENCE_VERIFIED", model=str(destination), files=len(records), bytes=sum(entry["bytes"] for entry in records))))

if __name__ == "__main__":
    main()
