"""Explicit model installation, separate from offline production. No automatic full model downloads."""
from pathlib import Path
from huggingface_hub import snapshot_download
root=Path(__file__).resolve().parents[1]/'.local/models/kokoro'
snapshot_download('hexgrad/Kokoro-82M',revision='f3ff3571791e39611d31c381e3a41a3af07b4987',local_dir=str(root),allow_patterns=['config.json','kokoro-v1_0.pth','voices/af_heart.pt','voices/bf_emma.pt','LICENSE','README.md'])
print(root)
