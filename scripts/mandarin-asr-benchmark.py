"""Official Qwen demonstration audio, internal ASR evaluation only; no redistribution approval."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'.local/benchmarks/mandarin'
URL='https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-ASR-Repo/asr_zh.wav'
SOURCE='https://github.com/QwenLM/Qwen3-ASR/blob/main/examples/example_qwen3_forced_aligner.py'
EXPECTED='甚至出现交易几乎停滞的情况。'
def main():
 DEST.mkdir(parents=True,exist_ok=True);audio=DEST/'official-asr-zh.wav'
 if not audio.exists():
  with urllib.request.urlopen(URL,timeout=60) as response:raw=response.read(10*1024*1024+1)
  if len(raw)>10*1024*1024:raise ValueError('Demonstration audio exceeds evaluation size limit')
  audio.write_bytes(raw)
 request=DEST/'request.json';request.write_text(json.dumps(dict(op='asr',audio=[str(audio)],config=dict(asrModel=str(ROOT/'.local/models/qwen3-asr'),asrDevice='cuda'))),encoding='utf-8')
 python=ROOT/'.local/engines/asr/Scripts/python.exe';result=subprocess.run([str(python),str(ROOT/'engines/runner.py'),str(request)],capture_output=True,text=True,encoding='utf-8',timeout=600)
 (DEST/'runtime.log').write_text(result.stderr,encoding='utf-8');inference=json.loads(result.stdout.strip().splitlines()[-1]);report=dict(source=SOURCE,url=URL,input_sha256=hashlib.sha256(audio.read_bytes()).hexdigest(),expected=EXPECTED,inference=inference,rights='Official demonstration offered for inference examples; public reuse/redistribution rights NOT_VERIFIED',scope='Single short Mandarin demonstration; not a WER corpus, translation quality or forced-alignment benchmark',humanReview='NOT_REVIEWED')
 if result.returncode or inference.get('error'):report['status']='BLOCKED_OR_FAILED'
 else:
  actual=inference['results'][0];normalize=lambda value:''.join(c for c in value if c.isalnum());report['exactNormalizedMatch']=normalize(actual['text'])==normalize(EXPECTED);report['status']='VERIFIED_ONE_MANDARIN_ASR_SAMPLE' if report['exactNormalizedMatch'] and actual['language']=='Chinese' else 'FLAGGED_REQUIRES_REVIEW'
 (ROOT/'docs/evidence/acs-mandarin-asr.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False));return 0 if report['status']=='VERIFIED_ONE_MANDARIN_ASR_SAMPLE' else 2
if __name__=='__main__':
 if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8')
 sys.exit(main())
