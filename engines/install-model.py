"""Explicit revision-pinned setup. Called only by the durable installation job."""
import hashlib
import fnmatch
import json
import sys
from pathlib import Path
from huggingface_hub import HfApi, snapshot_download

PROFILES = {
 'kokoro': [('hexgrad/Kokoro-82M','f3ff3571791e39611d31c381e3a41a3af07b4987','kokoro',['config.json','kokoro-v1_0.pth','voices/af_heart.pt','voices/bf_emma.pt','LICENSE','README.md'])],
 'qwen-asr': [('Qwen/Qwen3-ASR-1.7B','7278e1e70fe206f11671096ffdd38061171dd6e5','qwen3-asr',['*.json','*.safetensors','*.txt','README.md','LICENSE'])],
 'vieneu': [('pnnbao-ump/VieNeu-TTS-v3-Turbo','61b85e3d937fbbacb387714180e8182823512523','vieneu',['update/*','config.json','speaker_encoder.onnx','denoiser.onnx','README.md']),('OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano','6aa02b01e445cc585582cf0ba480bc3ea6c8dd68','moss-nano',['*.json','*.py','*.safetensors','README.md'])],
}

def verify_official_file(file, metadata):
 if file.is_symlink() or not file.is_file():raise ValueError('Checkpoint file is missing or redirected: '+metadata.rfilename)
 with file.open('rb') as handle:digest=hashlib.file_digest(handle,'sha256').hexdigest()
 if metadata.size is not None and file.stat().st_size!=metadata.size:raise ValueError('Official checkpoint size mismatch: '+metadata.rfilename)
 official_sha=getattr(metadata.lfs,'sha256',None) if metadata.lfs else None
 if official_sha:
  if digest!=official_sha:raise ValueError('Official checkpoint SHA-256 mismatch: '+metadata.rfilename)
 else:
  # Git stores small non-LFS objects with a blob header. The revision-pinned API supplies their object IDs.
  git_blob=hashlib.sha1(('blob '+str(file.stat().st_size)+'\0').encode())
  with file.open('rb') as handle:
   for chunk in iter(lambda:handle.read(1024*1024),b''):git_blob.update(chunk)
  if not metadata.blob_id or git_blob.hexdigest()!=metadata.blob_id:raise ValueError('Official Git blob checksum mismatch: '+metadata.rfilename)
 return dict(path=metadata.rfilename,bytes=file.stat().st_size,sha256=digest,official_lfs_sha256=official_sha,official_git_blob=metadata.blob_id,official_checksum_verified=True)

def main():
 request=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
 models=Path(request['models']).resolve()
 if any(token in str(models).lower() for token in ('asset-forge','assetforgestudio')):raise ValueError('Checkpoint installation requires ACS-owned storage')
 for repo,revision,folder,patterns in PROFILES[request['profile']]:
  dest=models/folder
  if not dest.resolve().is_relative_to(models):raise ValueError('Checkpoint destination escaped ACS ownership')
  metadata=HfApi().model_info(repo_id=repo,revision=revision,files_metadata=True)
  selected=[entry for entry in metadata.siblings if any(fnmatch.fnmatchcase(entry.rfilename,pattern) for pattern in patterns)]
  if not selected or not any(entry.rfilename.endswith(('.safetensors','.pth','.pt','.onnx')) for entry in selected):raise ValueError('Pinned profile lacks expected weight files')
  snapshot_download(repo,revision=revision,local_dir=str(dest),allow_patterns=patterns)
  files=[]
  for entry in sorted(selected,key=lambda item:item.rfilename):
   file=dest/entry.rfilename
   if not file.resolve().is_relative_to(dest.resolve()):raise ValueError('Checkpoint file escaped model storage')
   files.append(verify_official_file(file,entry))
  manifest=dict(repo=repo,revision=revision,files=files,inference='NOT_VERIFIED',official_checksums_verified=True,license_review='Inspect pinned official model card and voices before public use')
  temporary=dest/'acs-manifest.json.partial';temporary.write_text(json.dumps(manifest,indent=2),encoding='utf-8');temporary.replace(dest/'acs-manifest.json')
  print(json.dumps(dict(repo=repo,revision=revision,path=str(dest),files=len(files))),flush=True)
if __name__=='__main__':main()
