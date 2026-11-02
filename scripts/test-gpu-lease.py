"""Two-process OS lock contention and crash recovery, without loading a model."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('runner',ROOT/'engines/runner.py')
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)

def main():
    with tempfile.TemporaryDirectory(prefix='acs-lease-') as directory:
        root=Path(directory);lock=root/'gpu.lock';request=root/'lease.json'
        request.write_text(json.dumps(dict(op='lease-test',seconds=120,config=dict(gpuLock=str(lock)))),encoding='utf-8')
        child=subprocess.Popen([sys.executable,str(ROOT/'engines/runner.py'),str(request)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            deadline=time.monotonic()+15
            while not (root/'acs-gpu-owner.json').exists() and time.monotonic()<deadline:
                if child.poll() is not None: raise RuntimeError(child.communicate())
                time.sleep(.05)
            if not (root/'acs-gpu-owner.json').exists():raise RuntimeError('Lease owner did not start')
            try:
                with runner.gpu_lease(dict(gpuLock=str(lock))): pass
            except RuntimeError as exc:
                assert 'GPU_BUSY' in str(exc)
            else: raise AssertionError('Both processes acquired the same lease')
            child.kill();child.wait(timeout=10)
            # OS lock must release even when normal cleanup did not run.
            deadline=time.monotonic()+5
            while True:
                try:
                    with runner.gpu_lease(dict(gpuLock=str(lock))):time.sleep(.1)
                    break
                except RuntimeError:
                    if time.monotonic()>=deadline:raise
                    time.sleep(.1)
            assert not (root/'acs-gpu-owner.json').exists()
        finally:
            if child.poll() is None:child.kill();child.wait(timeout=10)
    report=dict(status='VERIFIED',contention='GPU_BUSY',crash_recovery='PASS',metadata_cleanup='PASS',platform=sys.platform)
    evidence=ROOT/'docs/evidence/acs-gpu-lease.json';evidence.parent.mkdir(parents=True,exist_ok=True)
    evidence.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))

if __name__=='__main__':main()
