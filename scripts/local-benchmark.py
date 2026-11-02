"""Small real inference evidence; never labels technical output as human quality approval."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('task',choices=['script','english','english-gb','vietnamese']);args=parser.parse_args()
out=root/'.local/benchmarks';out.mkdir(parents=True,exist_ok=True)
config=dict(llmUrl='http://127.0.0.1:11434/v1',llmModel='qwen3-vl:4b-instruct-q4_K_M',ttsEnModel=str(root/'.local/models/kokoro'),voiceEn='af_heart',voiceEnGb='bf_emma',ttsViModel=str(root/'.local/models/vieneu'),ttsViCodec=str(root/'.local/models/moss-nano'),voiceVi='Minh Quân',gpuLock='')
request=dict(op='script',config=config,system='Write a script for a clearly labeled software demonstration. Return a JSON object with a shots array containing exactly three elements. Each element has a text field containing an original English narration sentence. Do not return placeholder words. Use only supplied information.',prompt='Autonomous Creative Studio stores original files, creates editable drafts and exports videos locally. This sample is a software test fixture. It has not been published. Write three narration sentences explaining these facts.')
if args.task=='english':request=dict(op='tts',config=config,language='en-US',text='Welcome to Autonomous Creative Studio. This is a local voice test. Original files and previous versions remain available for review.',output=str(out/'english-kokoro.wav'))
elif args.task=='english-gb':request=dict(op='tts',config=config,language='en-GB',text='Welcome to Autonomous Creative Studio. This is a British English voice test. Please review the narration before publication.',output=str(out/'english-gb-kokoro.wav'))
elif args.task=='vietnamese':request=dict(op='tts',config=config,language='vi-VN',text='Xin chào, đây là bản kiểm tra giọng đọc tiếng Việt trên máy. Ứng dụng lưu bản gốc, tạo bản nháp và xuất video để bạn kiểm tra trước khi đăng.',output=str(out/'vietnamese-vieneu.wav'))
file=out/(args.task+'.request.json');file.write_text(json.dumps(request),encoding='utf-8')
result=subprocess.run([sys.executable,str(root/'engines/runner.py'),str(file)],capture_output=True,text=True,encoding='utf-8',timeout=900)
report=dict(task=args.task,exit_code=result.returncode,stdout=result.stdout,stderr=result.stderr[-10000:],human_review='NOT_REVIEWED',fixture=True)
evidence=root/'docs/evidence';evidence.mkdir(exist_ok=True)
(evidence/('acs-'+args.task+'-inference.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False));sys.exit(result.returncode)
