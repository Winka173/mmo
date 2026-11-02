"""One explicit CUDA embedding probe; no CPU fallback or public approval."""
import json
import subprocess
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
folder=ROOT/".local/benchmarks/embedding-cuda"
folder.mkdir(parents=True,exist_ok=True)
request=dict(config=dict(embeddingModel=str(ROOT/".local/models/qwen3-embedding-0.6b"),embeddingDevice="cuda"),texts=[
    dict(id="query",role="query",text="tìm video về sao Kim và khí quyển nóng"),
    dict(id="venus",text="Sao Kim có khí quyển dày giữ nhiệt và bề mặt rất nóng."),
    dict(id="library",text="A neighborhood library lends books and provides quiet reading spaces.")])
file=folder/"request.json"
file.write_text(json.dumps(request,ensure_ascii=False),encoding="utf-8")
started=time.monotonic()
result=subprocess.run([str(ROOT/".local/engines/asr/Scripts/python.exe"),str(ROOT/"engines/embedding_engine.py"),str(file)],capture_output=True,text=True,encoding="utf-8",timeout=300)
(folder/"runtime.log").write_text(result.stderr,encoding="utf-8")
response=json.loads(result.stdout.strip().splitlines()[-1]);(folder/"result.json").write_text(json.dumps(response,ensure_ascii=False),encoding="utf-8")
report=dict(status="BLOCKED_OR_FAILED",at=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),requestedDevice="cuda",wallSeconds=time.monotonic()-started,fixture=True,humanReview="NOT_REVIEWED",publicPosting=False,productionConfigChanged=False,request=request)
if result.returncode or response.get("error"):
    report["error"]=response.get("error",str(result.returncode))
else:
    documents=response.pop("documents");query=documents[0]["vector"]
    scores={entry["id"]:sum(a*b for a,b in zip(query,entry["vector"])) for entry in documents[1:]}
    report.update(status="VERIFIED_CUDA_SMALL_EMBEDDING_FIXTURE_ONLY" if response["device"]=="cuda" and scores["venus"]>scores["library"] else "FLAGGED_REQUIRES_REVIEW",evidence=response,scores=scores,dimensions=[len(entry["vector"]) for entry in documents],caveat="Three controlled texts, not general multilingual retrieval, duplicate prevention, truth/rights or human certification")
(ROOT/"docs/evidence/acs-semantic-cuda.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(report,ensure_ascii=True))
raise SystemExit(0 if report["status"].startswith("VERIFIED") else 2)
