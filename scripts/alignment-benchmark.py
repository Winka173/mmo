"""Reproduce English acoustic alignment against an explicit existing speech request.

Example: .local/engines/asr/Scripts/python.exe scripts/alignment-benchmark.py
  .local/alignment-benchmark-request.json
No synthesis, cloud inference, account actions, GPU use or human approval.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

def sha(file):
    with Path(file).open("rb") as handle:
        return hashlib.file_digest(handle,"sha256").hexdigest()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("request")
    parser.add_argument("--output",default="docs/evidence/acs-english-word-alignment.json")
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    request=Path(args.request).resolve()
    value=json.loads(request.read_text(encoding="utf-8-sig"))
    source_hashes={line["file"]:sha(line["file"]) for line in value["lines"]}
    engine=root/"engines/alignment_engine.py"
    environment=dict(os.environ,PYTHONDONTWRITEBYTECODE="1",PYTHONUTF8="1")
    started=time.time()
    run=subprocess.run([sys.executable,str(engine),str(request)],capture_output=True,text=True,encoding="utf-8",env=environment,timeout=900)
    data=json.loads(run.stdout.strip().splitlines()[-1])
    if run.returncode or "error" in data:
        raise RuntimeError(data.get("error",run.stderr))
    output=Path(args.output)
    output.parent.mkdir(parents=True,exist_ok=True)
    # This standard benchmark request contains: real plain-English narration,
    # unsupported numeric source lines, then deliberately unrelated wording over
    # the first audio. Each must retain its distinct state.
    results=data["results"]
    assert results[0]["status"]=="aligned" and len(results[0]["words"])>0
    assert results[-1]["status"]=="unknown" and "MISMATCH" in results[-1]["reason"]
    assert any(line["status"]=="unknown" and "UNSUPPORTED_TEXT" in line["reason"] for line in results)
    vi_request=request.with_name(request.stem+"-unsupported-vi.json")
    vi_request.write_text(json.dumps(dict(value,language="vi-VN")),encoding="utf-8")
    unsupported=subprocess.run([sys.executable,str(engine),str(vi_request)],capture_output=True,text=True,encoding="utf-8",env=environment,timeout=30)
    vi_result=json.loads(unsupported.stdout.strip().splitlines()[-1])
    assert unsupported.returncode!=0 and "UNSUPPORTED_LANGUAGE" in vi_result.get("error","")
    assert all(sha(file)==digest for file,digest in source_hashes.items())
    report=dict(status="VERIFIED_ACTUAL_ENGLISH_CPU_CTC_INFERENCE_NOT_HUMAN_WORD_BOUNDARY_BENCHMARK",at=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),wallSeconds=time.time()-started,request=str(request),requestSha256=sha(request),python=sys.executable,engineSha256=sha(engine),sourceAudioHashes=source_hashes,originalAudioPreserved=True,inference=data,unsupportedVietnamese=vi_result,stderr=run.stderr,voiceInference="NOT_RERUN; byte-identical actual Kokoro audio supplied explicitly",humanListening="NOT_PERFORMED",wordBoundaryGroundTruth="NOT_AVAILABLE",publication="NONE")
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(dict(status=report["status"],output=str(output),alignedLines=sum(line["status"]=="aligned" for line in results),unknownLines=sum(line["status"]=="unknown" for line in results),wallSeconds=report["wallSeconds"])))

if __name__=="__main__":
    main()
