"""Bootstrap the selected local image checkpoint; no inference or paid API."""
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
import time
import re
import shutil

ROOT=Path(__file__).resolve().parents[1]
os.environ['HF_HOME']=str(ROOT/'.local/huggingface')

REPO='black-forest-labs/FLUX.2-klein-4B'
REVISION='e7b7dc27f91deacad38e78976d1f2b499d76a294'
DEST=ROOT/'.local/models/flux2-klein-4b'
PREFIXES=('scheduler/','text_encoder/','tokenizer/','transformer/','vae/')

def download(entry):
    name=entry['rfilename'];dest=DEST/name
    if '..' in Path(name).parts or Path(name).is_absolute() or dest.is_symlink() or not dest.resolve().is_relative_to(DEST.resolve()):raise ValueError('Invalid checkpoint destination path')
    dest.parent.mkdir(parents=True,exist_ok=True);expected=entry.get('lfs',{}).get('sha256');size=entry['size']
    if dest.is_file() and dest.stat().st_size==size:
        with dest.open('rb') as handle:actual=hashlib.file_digest(handle,'sha256').hexdigest()
        if not expected or actual==expected:return
    temporary=dest.with_name(dest.name+'.acs-partial');offset=temporary.stat().st_size if temporary.exists() else 0
    if offset>size:raise ValueError('Invalid partial checkpoint size')
    if size<=4*1024*1024:
        url=f'https://huggingface.co/{REPO}/resolve/{REVISION}/{name}?download=true'
        with urllib.request.urlopen(url,timeout=30) as response:data=response.read(size+1)
        if len(data)!=size:raise ValueError('Small checkpoint file size mismatch')
        if expected and hashlib.sha256(data).hexdigest()!=expected:raise ValueError('Small checkpoint hash mismatch')
        temporary.write_bytes(data);os.replace(temporary,dest);return
    def chunk(start,end):
            url=f'https://huggingface.co/{REPO}/resolve/{REVISION}/{name}?download=true&acs_part={start}'
            for attempt in range(5):
                try:
                    req=urllib.request.Request(url,headers={'Range':f'bytes={start}-{end}'})
                    with urllib.request.urlopen(req,timeout=30) as response:
                        content_range=response.headers.get('Content-Range','');match=re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)',content_range)
                        if response.status!=206 or not match or tuple(map(int,match.groups()))!=(start,end,size):raise ValueError('Download server did not honor the bounded byte range')
                        data=response.read(end-start+2)
                    if len(data)!=end-start+1:raise ValueError('Incomplete model download chunk')
                    return data
                except Exception:
                    if attempt==4:raise
                    time.sleep(min(5,attempt+1))
    last_notice=0
    # At most 8 concurrent 16 MiB chunks across two files; append in order for crash-safe resume.
    with temporary.open('ab') as handle,ThreadPoolExecutor(max_workers=4) as chunks:
        while offset<size:
            starts=range(offset,min(size,offset+4*16*1024*1024),16*1024*1024)
            pending=[(start,min(size-1,start+16*1024*1024-1),chunks.submit(chunk,start,min(size-1,start+16*1024*1024-1))) for start in starts]
            for start,end,future in pending:
                data=future.result();handle.write(data);handle.flush();offset=end+1
                if time.time()-last_notice>10 or offset==size:
                    print(json.dumps(dict(file=name,completed=offset,total=size)),flush=True);last_notice=time.time()
    with temporary.open('rb') as handle:actual=hashlib.file_digest(handle,'sha256').hexdigest()
    if expected and actual!=expected:raise ValueError('Downloaded checkpoint SHA mismatch: '+name)
    os.replace(temporary,dest)

def main():
    global DEST
    if len(sys.argv)>1:
        request=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'));models=Path(request['models']).resolve()
        if 'asset-forge' in str(models).lower() or 'assetforgestudio' in str(models).lower():raise ValueError('Image setup must use an ACS-owned folder')
        DEST=models/'flux2-klein-4b'
    DEST.mkdir(parents=True,exist_ok=True)
    if not DEST.resolve().is_relative_to(DEST.parent.resolve()) or any(token in str(DEST.resolve()).lower() for token in ('asset-forge','assetforgestudio')):
        raise ValueError('Image checkpoint destination escaped ACS ownership')
    with urllib.request.urlopen(f'https://huggingface.co/api/models/{REPO}/revision/{REVISION}?blobs=true',timeout=30) as response:
        info=json.load(response)
    files=[f for f in info['siblings'] if f['rfilename'].startswith(PREFIXES) or f['rfilename'] in ('README.md','LICENSE.md','model_index.json')]
    total=sum(f.get('size',0) for f in files)
    print(json.dumps(dict(stage='download',repo=REPO,revision=REVISION,bytes=total,files=len(files))),flush=True)
    required=sum(f.get('size',0) for f in files if not (DEST/f['rfilename']).is_file())
    if shutil.disk_usage(DEST).free<required+4*1024**3:raise ValueError('Insufficient disk space for selected image checkpoint plus safety margin')
    # Bounded/resumable ranges avoid stalled whole-file transfers through the Windows network proxy.
    with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(download,files))
    inventory=[]
    for entry in files:
        file=DEST/entry['rfilename']
        if file.is_symlink() or not file.resolve().is_relative_to(DEST.resolve()):raise ValueError('Checkpoint contains a redirected file')
        with file.open('rb') as handle:digest=hashlib.file_digest(handle,'sha256').hexdigest()
        expected=entry.get('lfs',{}).get('sha256')
        if expected and digest!=expected:raise ValueError('Official checkpoint SHA mismatch: '+entry['rfilename'])
        if file.stat().st_size!=entry['size']:raise ValueError('Checkpoint size mismatch')
        inventory.append(dict(path=entry['rfilename'],bytes=file.stat().st_size,sha256=digest,official_lfs_sha256=expected))
    manifest=dict(repo=REPO,revision=REVISION,files=inventory,source=f'https://huggingface.co/{REPO}/tree/{REVISION}',license='Apache-2.0; inspect pinned LICENSE.md and model card',inference='NOT_VERIFIED')
    marker=DEST/'acs-manifest.json.partial';marker.write_text(json.dumps(manifest,indent=2),encoding='utf-8');os.replace(marker,DEST/'acs-manifest.json')
    print(json.dumps(dict(stage='download_verified',path=str(DEST),bytes=total,files=len(inventory),inference='NOT_VERIFIED')),flush=True)

if __name__=='__main__':main()
