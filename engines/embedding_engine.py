"""Offline text embeddings, separate from the production voice runner fingerprint."""
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import sys
import time
from contextlib import nullcontext
from runner import gpu_lease

REVISION = "97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3"
WEIGHT_SHA = "0437e45c94563b09e13cb7a64478fc406947a93cb34a7e05870fc8dcd48e23fd"
INSTRUCTION = "Given a content search query, retrieve relevant original video scripts."

def main(request):
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    config = request["config"]
    model_path = Path(config.get("embeddingModel") or "")
    if not config.get("embeddingModel") or not model_path.is_dir():
        raise ValueError("NEEDS_PROVIDER: configure the selected local embedding checkpoint")
    manifest = json.loads((model_path / "acs-manifest.json").read_text(encoding="utf-8"))
    if manifest.get("repo") != "Qwen/Qwen3-Embedding-0.6B" or manifest.get("revision") != REVISION:
        raise ValueError("QUALITY_LOCK: unexpected embedding checkpoint revision")
    for entry in manifest["files"]:
        file = model_path / entry["path"]
        if not file.resolve().is_relative_to(model_path.resolve()) or file.is_symlink():
            raise ValueError("QUALITY_LOCK: embedding checkpoint contains a redirected file")
        with file.open("rb") as handle:
            sha = hashlib.file_digest(handle, "sha256").hexdigest()
        if sha != entry["sha256"] or file.stat().st_size != entry["bytes"]:
            raise ValueError("QUALITY_LOCK: embedding checkpoint bytes changed")
    if not any(entry["path"] == "model.safetensors" and entry["sha256"] == WEIGHT_SHA for entry in manifest["files"]):
        raise ValueError("QUALITY_LOCK: embedding weights are absent from the pinned manifest")
    items = request.get("texts", [])
    if not 1 <= len(items) <= 32 or len({item["id"] for item in items}) != len(items):
        raise ValueError("Embedding requires 1..32 uniquely identified inputs")
    if any(not isinstance(item.get("text"), str) or not item["text"].strip() or len(item["text"]) > 6000 or item.get("role", "document") not in ("document", "query") for item in items):
        raise ValueError("Embedding input is empty, unsupported or over 6000 characters")
    device = config.get("embeddingDevice", "cuda")
    if device not in ("cpu", "cuda"):
        raise ValueError("Choose CPU or CUDA explicitly for embeddings")
    import torch
    import torch.nn.functional as functional
    from transformers import AutoModel, AutoTokenizer
    if device == "cuda" and not torch.cuda.is_available():
        raise ValueError("NEEDS_PROVIDER: requested embedding CUDA unavailable; no CPU/cloud fallback")
    started = time.monotonic()
    tokenizer = AutoTokenizer.from_pretrained(str(model_path), padding_side="left", local_files_only=True, trust_remote_code=False)
    tokens = []
    for item in items:
        text = f"Instruct: {INSTRUCTION}\nQuery:{item['text']}" if item.get("role") == "query" else item["text"]
        encoded = tokenizer(text, return_tensors="pt", truncation=False)
        if encoded["input_ids"].shape[1] > 2048:
            raise ValueError("Embedding text exceeds 2048-token application limit; split it instead of truncating")
        tokens.append(encoded)
    output = []
    with gpu_lease(config) if device == "cuda" else nullcontext():
        if device == "cuda":
            torch.cuda.reset_peak_memory_stats()
        model = AutoModel.from_pretrained(str(model_path), local_files_only=True, trust_remote_code=False,
            torch_dtype=torch.bfloat16 if device == "cuda" else torch.float32, attn_implementation="sdpa").to(device).eval()
        with torch.inference_mode():
            for item, encoded in zip(items, tokens):
                encoded = {key: value.to(device) for key, value in encoded.items()}
                # One sequence at a time, no padding: final non-padding token pooling.
                pooled = model(**encoded).last_hidden_state[:, -1].float()
                vector = functional.normalize(pooled, p=2, dim=1)[0].cpu().tolist()
                if len(vector) != 1024 or any(not math.isfinite(value) for value in vector):
                    raise ValueError("Embedding output has invalid dimensions or values")
                output.append(dict(id=item["id"], textSha256=hashlib.sha256(item["text"].encode()).hexdigest(), vector=vector))
    identity = dict(executionDevice=device, dtype="bfloat16" if device == "cuda" else "float32", revision=REVISION, files=manifest["files"], dimensions=1024, pooling="last_nonpadding_token", normalization="L2", queryInstruction=INSTRUCTION,
        engineSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), versions={name:importlib.metadata.version(name) for name in ("torch", "transformers", "tokenizers")})
    return dict(engine="qwen3-embedding", device=device, seconds=time.monotonic() - started,
        peakVramMiB=torch.cuda.max_memory_allocated()/1024**2 if device == "cuda" else None,
        identity=identity, fingerprint=hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest(), documents=output,
        semanticTruth="NOT_CERTIFIED", rights="NOT_CERTIFIED", humanReview="NOT_REVIEWED")

if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        request=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
        print(json.dumps(main(request), ensure_ascii=False))
    except Exception as error:
        print(json.dumps(dict(error=str(error)),ensure_ascii=False))
        sys.exit(1)
