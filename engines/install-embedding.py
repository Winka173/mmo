"""Selected pinned embedding weights only; compatible ASR runtime is read-only."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import urllib.request

REPO = "Qwen/Qwen3-Embedding-0.6B"
REVISION = "97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3"
WEIGHT_SHA = "0437e45c94563b09e13cb7a64478fc406947a93cb34a7e05870fc8dcd48e23fd"
NAMES = {"README.md", "config.json", "model.safetensors", "tokenizer.json", "tokenizer_config.json", "vocab.json", "merges.txt"}

def main():
    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
    models = Path(request["models"]).resolve()
    destination = models / "qwen3-embedding-0.6b"
    destination.mkdir(parents=True, exist_ok=True)
    if not destination.resolve().is_relative_to(models) or any(token in str(destination.resolve()).lower() for token in ("asset-forge", "assetforgestudio")):
        raise ValueError("Embedding checkpoint must remain in ACS-owned storage")
    # Reuse the bounded, resumable range downloader already tested for FLUX;
    # this invocation changes its fixed repository/selection, not any image files.
    spec = importlib.util.spec_from_file_location("acs_range_download", Path(__file__).with_name("install-image.py"))
    downloader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(downloader)
    downloader.REPO, downloader.REVISION, downloader.DEST = REPO, REVISION, destination
    with urllib.request.urlopen(f"https://huggingface.co/api/models/{REPO}/revision/{REVISION}?blobs=true", timeout=30) as response:
        metadata = json.load(response)
    files = [entry for entry in metadata["siblings"] if entry["rfilename"] in NAMES]
    if {entry["rfilename"] for entry in files} != NAMES:
        raise ValueError("Pinned embedding checkpoint file selection changed")
    weight = next(entry for entry in files if entry["rfilename"] == "model.safetensors")
    if weight["lfs"]["sha256"] != WEIGHT_SHA:
        raise ValueError("Official embedding weight hash does not match the selected pin")
    records = []
    for entry in files:
        downloader.download(entry)
        file = destination / entry["rfilename"]
        if file.is_symlink() or not file.resolve().is_relative_to(destination.resolve()):
            raise ValueError("Embedding file redirected outside checkpoint folder")
        with file.open("rb") as handle:
            sha256 = hashlib.file_digest(handle, "sha256").hexdigest()
        if file.stat().st_size != entry["size"] or entry.get("lfs", {}).get("sha256", sha256) != sha256:
            raise ValueError("Embedding download hash or size mismatch")
        records.append(dict(path=entry["rfilename"], bytes=file.stat().st_size, sha256=sha256))
    card = (destination / "README.md").read_text(encoding="utf-8")
    if "license: apache-2.0" not in card[:1000].lower():
        raise ValueError("Pinned embedding card lacks expected license declaration")
    manifest = dict(repo=REPO, revision=REVISION, license="Apache-2.0 as declared by pinned model card", source=f"https://huggingface.co/{REPO}/tree/{REVISION}", files=records, inference="NOT_VERIFIED")
    temporary = destination / "acs-manifest.json.partial"
    temporary.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    os.replace(temporary, destination / "acs-manifest.json")
    print(json.dumps(dict(status="INSTALLED_NOT_INFERENCE_VERIFIED", model=str(destination), files=len(records), bytes=sum(entry["bytes"] for entry in records))))

if __name__ == "__main__":
    main()
