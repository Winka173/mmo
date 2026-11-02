"""ACS local inference boundary. No cloud redirects, no shell, OS GPU lease shared with AFS."""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import urllib.request
from urllib.parse import urlparse

if hasattr(sys.stdout,'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr,'reconfigure'): sys.stderr.reconfigure(encoding='utf-8')

@contextlib.contextmanager
def gpu_lease(config):
    root = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'AssetForgeStudio' / 'locks'
    lock = Path(config.get('gpuLock') or root / 'gpu.lock')
    lock.parent.mkdir(parents=True, exist_ok=True)
    handle = lock.open('a+b'); handle.seek(0)
    if lock.stat().st_size == 0: handle.write(b'0'); handle.flush()
    handle.seek(0)
    try:
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close(); raise RuntimeError('GPU_BUSY: another application holds the GPU lease; retry later')
    # Metadata belongs to ACS only. Never rewrite AFS's binary lock file.
    meta = lock.with_name('acs-gpu-owner.json'); stop = threading.Event()
    def heartbeat():
        while not stop.is_set():
            temp = meta.with_suffix('.tmp')
            temp.write_text(json.dumps(dict(pid=os.getpid(), owner='ACS', heartbeat=time.time())), encoding='utf-8')
            os.replace(temp, meta)
            stop.wait(5)
    thread = threading.Thread(target=heartbeat, daemon=True); thread.start()
    try: yield
    finally:
        stop.set(); thread.join(timeout=6)
        meta.unlink(missing_ok=True)
        handle.seek(0)
        if os.name == 'nt': msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else: fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): raise RuntimeError('AI redirects are disabled')

def checkpoint_digest(path):
    """Fingerprint actual local weights, config and trusted local model source."""
    path=Path(path); digest=hashlib.sha256(); files=[]
    candidates=[path] if path.is_file() else sorted(p for p in path.rglob('*') if p.is_file()
        and '.cache' not in p.parts and '__pycache__' not in p.parts
        and (p.suffix in ('.pth','.pt','.safetensors','.onnx','.json','.py','.txt','.model','.bin'))
        and p.name != 'acs-manifest.json')
    for file in candidates:
        h=hashlib.sha256()
        with file.open('rb') as handle:
            for chunk in iter(lambda:handle.read(1024*1024),b''): h.update(chunk)
        name=file.name if path.is_file() else file.relative_to(path).as_posix()
        record=dict(path=name,sha256=h.hexdigest(),bytes=file.stat().st_size)
        files.append(record); digest.update(json.dumps(record,sort_keys=True).encode())
    if not files: raise ValueError('No model files available to fingerprint')
    return digest.hexdigest(),files

def voice_environment(req):
    import importlib.metadata as metadata
    import importlib.util
    vi=req['language']=='vi-VN'; versions={}
    for name in ['torch','torchaudio','numpy','transformers']+(['vieneu','phonemizer'] if vi else ['kokoro','misaki','spacy','en_core_web_sm']):
        try:versions[name]=metadata.version(name)
        except metadata.PackageNotFoundError:versions[name]=None
    preset=None
    if vi:
        spec=importlib.util.find_spec('vieneu')
        if spec and spec.origin:
            file=Path(spec.origin).parent/'assets/voices_v3_turbo.json'
            if file.is_file():preset=hashlib.sha256(file.read_bytes()).hexdigest()
    runtime=dict(versions=versions,preset_sha256=preset,runner_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    return dict(fingerprint=hashlib.sha256(json.dumps(runtime,sort_keys=True).encode()).hexdigest(),**runtime)

def asr_environment(req):
    import importlib.metadata as metadata
    c=req['config']; model=Path(c.get('asrModel') or '')
    if not c.get('asrModel') or not model.is_dir():raise ValueError('NEEDS_PROVIDER: local ASR checkpoint missing')
    weights,files=checkpoint_digest(model);versions={}
    for name in ['qwen-asr','torch','transformers','soundfile']:
        try:versions[name]=metadata.version(name)
        except metadata.PackageNotFoundError:versions[name]=None
    state=dict(model_sha256=weights,versions=versions,runner_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    return dict(fingerprint=hashlib.sha256(json.dumps(state,sort_keys=True).encode()).hexdigest(),model_files=files,**state)

def script(req):
    c=req['config']; url=c['llmUrl'].rstrip('/')
    parsed=urlparse(url)
    if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1','localhost','::1'):
        raise ValueError('Cloud inference blocked')
    if not c.get('llmModel'): raise ValueError('NEEDS_PROVIDER: choose an installed local LLM in Settings')
    schema=dict(type='object',properties=dict(shots=dict(type='array',minItems=3,maxItems=12,items=dict(type='object',properties=dict(text=dict(type='string')),required=['text'],additionalProperties=False))),required=['shots'],additionalProperties=False)
    if req.get('schema'):schema=req['schema']
    body=dict(model=c['llmModel'], temperature=0.4, max_tokens=min(6000,int(req.get('maxTokens',1800))), stream=False,
        response_format=dict(type='json_schema',json_schema=dict(name='studio_script',strict=True,schema=schema)), messages=[dict(role='system',content=req.get('system','Return only the supplied JSON schema. Follow the requested language. Do not invent facts.')),dict(role='user',content=req['prompt'])])
    started=time.time()
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect);managed=c.get('llmManaged',False);root=url.removesuffix('/v1');samples=[];stop=threading.Event();thread=None
    if managed:
        with opener.open(root+'/api/tags',timeout=10) as response:tags=json.load(response)
        installed=next((m for m in tags.get('models',[]) if m.get('name')==c['llmModel']),None)
        if not installed:raise ValueError('NEEDS_PROVIDER: requested local model is not installed')
        if c.get('llmModelDigest') and c['llmModelDigest']!=installed.get('digest'):raise ValueError('QUALITY_LOCK: LLM manifest changed; create a fresh run with the selected checkpoint')
        def monitor():
            while not stop.is_set():
                try:
                    with opener.open(root+'/api/ps',timeout=2) as response:models=json.load(response).get('models',[])
                    samples.extend(m for m in models if m.get('name')==c['llmModel']);samples[:]=samples[-120:]
                except Exception:pass
                stop.wait(.4)
        thread=threading.Thread(target=monitor,daemon=True);thread.start()
        body=dict(model=c['llmModel'],stream=False,think=False,format=schema,messages=body['messages'],options=dict(temperature=.4,num_ctx=c.get('maxContext',8192),num_predict=min(6000,int(req.get('maxTokens',1800)))),keep_alive=0)
        if c.get('llmDevice','cuda')=='cpu':body['options']['num_gpu']=0  # CPU profile on a server that still exposes the GPU to the fast profile
        if req.get('images'):body['messages'][-1]['images']=req['images']
    try:
        with gpu_lease(c) if c.get('llmDevice','cuda')!='cpu' else contextlib.nullcontext():
            request=urllib.request.Request(root+'/api/chat' if managed else url+'/chat/completions',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
            with opener.open(request,timeout=600) as response:result=json.load(response)
    finally:
        stop.set()
        if thread:thread.join(timeout=3)
    execution=max(samples,key=lambda s:s.get('size_vram',0),default=None)
    if managed and c.get('llmDevice','cuda')=='cuda' and (not execution or execution.get('size_vram',0)<=0):raise ValueError('NEEDS_PROVIDER: requested LLM CUDA inference could not be verified; no silent CPU fallback')
    text=result['message']['content'] if managed else result['choices'][0]['message']['content'];text=text.removeprefix('```json').removesuffix('```').strip()
    return dict(script=json.loads(text),model=c['llmModel'],model_digest=installed.get('digest') if managed else None,seconds=time.time()-started,usage=result.get('usage',dict(input_tokens=result.get('prompt_eval_count'),output_tokens=result.get('eval_count'))),mode='local',device='cuda' if execution and execution.get('size_vram',0)>0 else 'cpu' if managed else 'unverified',requested_device=c.get('llmDevice','cuda'),execution=execution)

def narrate(req):
    # Models must be installed beforehand. Hugging Face stays offline during production.
    os.environ['HF_HUB_OFFLINE']='1'; os.environ['TRANSFORMERS_OFFLINE']='1'
    c=req['config']; lang=req['language']; started=time.time()
    if lang not in ('vi-VN','en-US','en-GB'):
        raise ValueError('Unsupported narration language: '+str(lang))
    import numpy as np
    import soundfile as sf
    import torch
    requested_device=c.get('ttsDevice','auto')
    if requested_device not in ('auto','cpu','cuda'):raise ValueError('Invalid ttsDevice')
    if requested_device=='cuda' and not torch.cuda.is_available():
        raise ValueError('NEEDS_PROVIDER: CUDA was requested but is unavailable; no silent CPU fallback')
    device=('cuda' if torch.cuda.is_available() else 'cpu') if requested_device=='auto' else requested_device
    with gpu_lease(c) if device=='cuda' else contextlib.nullcontext():
        if device=='cuda': torch.cuda.reset_peak_memory_stats()
        if lang.startswith('en'):
            model=Path(c.get('ttsEnModel') or '')
            if not model.is_dir(): raise ValueError('NEEDS_PROVIDER: configure local Kokoro checkpoint directory')
            from kokoro import KModel, KPipeline
            weights=next(iter(model.glob('kokoro*.pth')),None)
            if weights is None: raise ValueError('Missing Kokoro .pth checkpoint')
            engine=KModel(repo_id='hexgrad/Kokoro-82M',config=str(model/'config.json'),model=str(weights)).to(device).eval()
            import spacy
            if not spacy.util.is_package('en_core_web_sm'):
                raise ValueError('NEEDS_PROVIDER: install en_core_web_sm during setup, not production')
            pipeline=KPipeline(lang_code='b' if lang=='en-GB' else 'a',repo_id='hexgrad/Kokoro-82M',model=engine,device=device)
            voice=(c.get('voiceEnGb') or 'bf_emma') if lang=='en-GB' else (c.get('voiceEn') or 'af_heart')
            voice_path=model/'voices'/f'{voice}.pt'
            if not voice_path.is_file(): raise ValueError('Voice checkpoint missing: '+voice)
            # Kokoro 0.9.4 recognizes CPU FloatTensor only; its pipeline moves the
            # pack onto model.device itself. Passing a CUDA tensor is mistaken
            # for a voice-name string and crashes in load_voice().
            voice_tensor=torch.load(str(voice_path),map_location='cpu',weights_only=True).float()
            pieces=[np.asarray(audio.cpu() if hasattr(audio,'cpu') else audio) for _,_,audio in pipeline(req['text'],voice=voice_tensor,speed=1.0)]
            if not pieces: raise ValueError('TTS returned no audio')
            audio=np.concatenate(pieces); rate=24000; engine_id='kokoro'; checkpoint=weights
        else:
            model=Path(c.get('ttsViModel') or '')
            if not model.is_dir(): raise ValueError('NEEDS_PROVIDER: configure local VieNeu checkpoint directory')
            from vieneu import Vieneu
            # Local path and offline flags prevent hidden downloads/cloud inference.
            codec=Path(c.get('ttsViCodec') or '')
            if not codec.is_dir() or not c.get('ttsViCodec'):
                raise ValueError('NEEDS_PROVIDER: configure an audited local MOSS tokenizer directory')
            if device != 'cuda':
                raise ValueError('NEEDS_PROVIDER: VieNeu GPU path requires CUDA PyTorch; CPU ONNX must be configured separately')
            engine=Vieneu(mode='v3turbo',backbone_repo=str(model),model_subfolder='update',moss_tokenizer=str(codec),device=device,backend='pytorch')
            voice=c.get('voiceVi')
            if not voice: raise ValueError('Select an audited Vietnamese voice first')
            # Bound chunks and allow a larger frame budget for each; its phoneme-based
            # babble guard still caps generation. ASR review detects missing text.
            audio=engine.infer(req['text'],voice=voice,max_chars=120,max_new_frames=750); rate=getattr(engine,'sample_rate',48000)
            engine_id='vieneu'; checkpoint=model
        audio=np.asarray(audio,dtype=np.float32).reshape(-1)
        if not len(audio) or not np.isfinite(audio).all() or not np.any(np.abs(audio)>1e-5):
            raise ValueError('TTS returned empty, non-finite or silent audio')
        sf.write(req['output'],audio,rate)
    # Keep legacy single-file SHA for Kokoro and add a full effective model fingerprint.
    digest=None
    if checkpoint.is_file():
        with checkpoint.open('rb') as handle:digest=hashlib.file_digest(handle,'sha256').hexdigest()
    model_digest,model_files=checkpoint_digest(model)
    codec_digest,codec_files=checkpoint_digest(codec) if engine_id=='vieneu' else (None,[])
    import importlib.metadata as metadata
    sdk_version=metadata.version('vieneu' if engine_id=='vieneu' else 'kokoro')
    voice_asset_digest=None
    if engine_id=='vieneu':
        import vieneu
        voice_file=Path(vieneu.__file__).parent/'assets/voices_v3_turbo.json'
        voice_asset_digest=hashlib.sha256(voice_file.read_bytes()).hexdigest()
    return dict(engine=engine_id,checkpoint=str(checkpoint),checkpoint_sha256=digest,language=lang,device=device,seconds=time.time()-started,
        model_sha256=model_digest,model_files=model_files,codec_sha256=codec_digest,codec_files=codec_files,
        sdk_version=sdk_version,voice_asset_sha256=voice_asset_digest,torch_version=torch.__version__,
        audio_seconds=len(audio)/rate,peak_vram_mb=torch.cuda.max_memory_allocated()/1024**2 if device=='cuda' else None,
        human_review='NOT_REVIEWED',voice=voice,requested_device=requested_device)

def transcribe(req):
    os.environ['HF_HUB_OFFLINE']='1'; os.environ['TRANSFORMERS_OFFLINE']='1'
    import torch
    import soundfile as sf
    from qwen_asr import Qwen3ASRModel
    c=req['config']; started=time.time(); model=Path(c.get('asrModel') or '')
    if not c.get('asrModel') or not model.is_dir(): raise ValueError('NEEDS_PROVIDER: configure local Qwen3-ASR directory')
    files=req.get('audio',[])
    if not files or len(files)>40 or any(not Path(f).is_file() for f in files): raise ValueError('ASR requires 1–40 existing local audio files')
    requested=c.get('asrDevice','auto')
    if requested not in ('auto','cpu','cuda'):raise ValueError('Invalid asrDevice')
    if requested=='cuda' and not torch.cuda.is_available():raise ValueError('NEEDS_PROVIDER: ASR CUDA unavailable; no silent CPU fallback')
    device=('cuda' if torch.cuda.is_available() else 'cpu') if requested=='auto' else requested
    with gpu_lease(c) if device=='cuda' else contextlib.nullcontext():
        if device=='cuda':torch.cuda.reset_peak_memory_stats()
        engine=Qwen3ASRModel.from_pretrained(str(model),dtype=torch.bfloat16 if device=='cuda' else torch.float32,
            device_map='cuda:0' if device=='cuda' else 'cpu',attn_implementation='sdpa',
            max_inference_batch_size=1,max_new_tokens=1024,local_files_only=True)
        # Decode locally; never pass URL inputs or script text as ASR context.
        inputs=[]
        for file in files:
            wave,rate=sf.read(file,dtype='float32');inputs.append((wave,rate))
        results=engine.transcribe(audio=inputs,language=None)
    digest,model_files=checkpoint_digest(model)
    return dict(engine='qwen3-asr',device=device,requested_device=requested,model_sha256=digest,model_files=model_files,
        seconds=time.time()-started,peak_vram_mb=torch.cuda.max_memory_allocated()/1024**2 if device=='cuda' else None,
        results=[dict(file=file,language=result.language,text=result.text) for file,result in zip(files,results)],
        timestamps='NOT_REQUESTED',human_review='NOT_REVIEWED')

def detect_speech(req):
    import math
    import numpy as np
    import soundfile as sf
    import torch
    from scipy.signal import resample_poly
    c=req['config'];model=Path(c.get('vadModel') or '')
    if not c.get('vadModel') or not model.is_file():raise ValueError('NEEDS_PROVIDER: select an installed local Silero VAD checkpoint')
    checksum=hashlib.sha256(model.read_bytes()).hexdigest()
    if not c.get('vadSha256') or checksum!=c['vadSha256']:raise ValueError('QUALITY_LOCK: VAD checkpoint does not match its selected hash')
    files=req.get('audio',[])
    if not files or len(files)>40:raise ValueError('VAD requires 1–40 local audio files')
    started=time.time();torch.set_num_threads(1)
    engine=torch.jit.load(str(model),map_location='cpu').eval();results=[];rate=16000;window=512
    for file in files:
        info=sf.info(file)
        if info.duration<=0 or info.duration>600:raise ValueError('VAD supports bounded local clips up to 10 minutes each')
        audio,sr=sf.read(file,dtype='float32',always_2d=True);audio=audio.mean(axis=1)
        if not np.isfinite(audio).all():raise ValueError('Audio contains non-finite samples')
        if sr!=rate:
            divisor=math.gcd(sr,rate);audio=resample_poly(audio,rate//divisor,sr//divisor).astype(np.float32)
        engine.reset_states();intervals=[];begin=None;last_active=0;quiet=0;maximum=0
        with torch.inference_mode():
            for start in range(0,len(audio),window):
                chunk=torch.from_numpy(audio[start:start+window])
                if chunk.numel()<window:chunk=torch.nn.functional.pad(chunk,(0,window-chunk.numel()))
                probability=float(engine(chunk,rate).item());maximum=max(maximum,probability)
                if probability>=.5:
                    if begin is None:begin=start
                    quiet=0;last_active=min(len(audio),start+window)
                elif begin is not None:
                    if probability>=.35:quiet=0;last_active=min(len(audio),start+window)
                    else:quiet+=window
                    if quiet>=.2*rate:
                        if last_active-begin>=.25*rate:intervals.append([max(0,begin/rate-.03),min(len(audio)/rate,last_active/rate+.03)])
                        begin=None;quiet=0
        if begin is not None and last_active-begin>=.25*rate:intervals.append([max(0,begin/rate-.03),min(len(audio)/rate,last_active/rate+.03)])
        merged=[]
        for start,end in intervals:
            if merged and start-merged[-1][1]<.15:merged[-1][1]=end
            else:merged.append([start,end])
        duration=len(audio)/rate;speech=sum(end-start for start,end in merged)
        results.append(dict(file=file,duration=duration,speech=[dict(start=round(a,4),end=round(b,4)) for a,b in merged],speech_ratio=speech/duration,max_probability=maximum,leading_silence=merged[0][0] if merged else duration,trailing_silence=duration-merged[-1][1] if merged else duration))
    import importlib.metadata as metadata
    versions={name:metadata.version(name) for name in ('torch','scipy','numpy','soundfile')}
    return dict(engine='silero-vad',device='cpu',checkpoint=str(model),model_sha256=checksum,runner_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),versions=versions,seconds=time.time()-started,results=results,parameters=dict(onset=.5,offset=.35,min_speech_seconds=.25,end_silence_seconds=.2,padding_seconds=.03),word_timing='NOT_PROVIDED',human_review='NOT_REVIEWED')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('request');args=parser.parse_args()
    req=json.loads(Path(args.request).read_text(encoding='utf-8-sig'))
    try:
        if req['op']=='script': result=script(req)
        elif req['op']=='tts': result=narrate(req)
        elif req['op']=='asr': result=transcribe(req)
        elif req['op']=='voice-environment': result=voice_environment(req)
        elif req['op']=='asr-environment': result=asr_environment(req)
        elif req['op']=='vad': result=detect_speech(req)
        elif req['op']=='lease-test':
            with gpu_lease(req.get('config',{})): time.sleep(float(req.get('seconds',0)));result=dict(ok=True,pid=os.getpid())
        else: raise ValueError('Unsupported engine operation')
        print(json.dumps(result,ensure_ascii=False))
    except Exception as exc:
        print(json.dumps(dict(error=str(exc)),ensure_ascii=False));sys.exit(1)
if __name__=='__main__': main()
