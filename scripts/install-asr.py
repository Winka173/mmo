"""Explicit Qwen3-ASR download. Runtime uses only these pinned local files."""
import hashlib
import json
from pathlib import Path
from huggingface_hub import snapshot_download

root = Path(__file__).resolve().parents[1] / '.local/models/qwen3-asr'
repo = 'Qwen/Qwen3-ASR-1.7B'
revision = '7278e1e70fe206f11671096ffdd38061171dd6e5'
snapshot_download(repo, revision=revision, local_dir=str(root), allow_patterns=['*.json', '*.safetensors', '*.txt', 'README.md', 'LICENSE'])
files = []
for file in sorted(root.rglob('*')):
    if not file.is_file() or '.cache' in file.parts or file.name == 'acs-manifest.json': continue
    with file.open('rb') as handle: digest = hashlib.file_digest(handle, 'sha256').hexdigest()
    files.append(dict(path=file.relative_to(root).as_posix(), bytes=file.stat().st_size, sha256=digest))
(root/'acs-manifest.json').write_text(json.dumps(dict(repo=repo, revision=revision, files=files, license='Apache-2.0 per official model card', inference='NOT_VERIFIED'), indent=2), encoding='utf-8')
print(json.dumps(dict(path=str(root), repo=repo, revision=revision, files=len(files))))
