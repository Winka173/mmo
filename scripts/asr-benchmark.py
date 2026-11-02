"""Real local round-trip probe. No forced transcript or human approval."""
import json
import subprocess
import sys
import re
from pathlib import Path
if hasattr(sys.stdout,'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')

root=Path(__file__).resolve().parents[1]
folder=root/'.local/benchmarks'
inputs=[folder/'english-kokoro.wav',folder/'english-gb-kokoro.wav',folder/'vietnamese-vieneu.wav']
if (folder/'vietnamese-before-frame-fix.wav').is_file(): inputs.append(folder/'vietnamese-before-frame-fix.wav')
request=dict(op='asr',config=dict(asrModel=str(root/'.local/models/qwen3-asr'),asrDevice='cuda'),audio=[str(p) for p in inputs])
file=folder/'asr.request.json';file.write_text(json.dumps(request),encoding='utf-8')
result=subprocess.run([sys.executable,str(root/'engines/runner.py'),str(file)],capture_output=True,text=True,encoding='utf-8',timeout=900)
report=dict(task='asr-round-trip',exit_code=result.returncode,stdout=result.stdout,stderr=result.stderr[-16000:],human_review='NOT_REVIEWED',fixture=True)
if result.returncode==0:
    output=json.loads(result.stdout.strip().splitlines()[-1]);checks=[]
    normalize=lambda s: ' '.join(re.sub(r'[^\w\s]',' ',s.lower()).split())
    for item in output['results']:
        name=Path(item['file']).name
        task='vietnamese' if name.startswith('vietnamese') else 'english-gb' if name.startswith('english-gb') else 'english'
        reference=json.loads((folder/(task+'.request.json')).read_text(encoding='utf-8'))['text']
        checks.append(dict(file=item['file'],detected_language=item['language'],normalized_exact_match=normalize(reference)==normalize(item['text']),reference=reference,transcription=item['text']))
    report['checks']=checks
(root/'docs/evidence/acs-asr-inference.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False));sys.exit(result.returncode)
