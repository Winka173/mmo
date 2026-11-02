"""Download only the selected, pinned Silero checkpoint. No package/environment mutation."""
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.request

def main():
    request=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
    source=json.loads(Path(__file__).with_name('silero-source.json').read_text(encoding='utf-8'))
    target=Path(request['models'])/'silero-vad';target.mkdir(parents=True,exist_ok=True)
    for entry in source['files']:
        url=f"https://raw.githubusercontent.com/snakers4/silero-vad/{source['revision']}/{entry['path']}"
        with urllib.request.urlopen(url,timeout=90) as response:data=response.read(8*1024*1024+1)
        if len(data)>8*1024*1024 or hashlib.sha256(data).hexdigest()!=entry['sha256']:raise ValueError('Pinned VAD download checksum/size mismatch')
        temp=target/(entry['name']+'.download');temp.write_bytes(data);os.replace(temp,target/entry['name'])
    (target/'acs-manifest.json').write_text(json.dumps(source,indent=2),encoding='utf-8')
    print(json.dumps(dict(status='INSTALLED_NOT_INFERENCE_VERIFIED',model=str(target/'silero_vad.jit'),sha256=source['files'][0]['sha256'],source=source)))

if __name__=='__main__':main()
