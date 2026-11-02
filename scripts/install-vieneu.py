"""Explicit, revision-pinned setup; production never downloads model code/weights."""
import hashlib
import json
from pathlib import Path
from huggingface_hub import snapshot_download

ROOT = Path(__file__).resolve().parents[1]
MODELS = [
    ('pnnbao-ump/VieNeu-TTS-v3-Turbo', '61b85e3d937fbbacb387714180e8182823512523', 'vieneu',
     ['update/*', 'config.json', 'speaker_encoder.onnx', 'denoiser.onnx', 'README.md']),
    ('OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano', '6aa02b01e445cc585582cf0ba480bc3ea6c8dd68', 'moss-nano',
     ['*.json', '*.py', '*.safetensors', 'README.md']),
]

def main():
    for repo, revision, folder, patterns in MODELS:
        dest = ROOT / '.local/models' / folder
        snapshot_download(repo, revision=revision, local_dir=str(dest), allow_patterns=patterns)
        files = []
        for file in sorted(dest.rglob('*')):
            if not file.is_file() or '.cache' in file.parts:
                continue
            with file.open('rb') as handle:
                digest = hashlib.file_digest(handle, 'sha256').hexdigest()
            files.append(dict(path=file.relative_to(dest).as_posix(), bytes=file.stat().st_size, sha256=digest))
        manifest = dict(repo=repo, revision=revision, files=files, inference='NOT_VERIFIED',
                        license_review='Model cards declare Apache-2.0; inspect pinned README and voice provenance before public use')
        (dest / 'acs-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        print(json.dumps(dict(repo=repo, revision=revision, path=str(dest), files=len(files))), flush=True)

if __name__ == '__main__':
    main()
