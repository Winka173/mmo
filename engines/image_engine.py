"""Local FLUX.2 klein 4B boundary. Uses the same OS GPU lease as speech/LLM."""
import hashlib
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import sys
import time

os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
from runner import gpu_lease

PINNED_WEIGHTS={
 'text_encoder/model-00001-of-00002.safetensors':'8c0506e7f4936fa7e26183a4fd8da4e2bdbc5990ba64ae441f965d51228f36ea',
 'text_encoder/model-00002-of-00002.safetensors':'82f2bd839378541b0557bfabaf37c7d3d637071fdcb73302dedd7cf61162ce07',
 'transformer/diffusion_pytorch_model.safetensors':'9f29f9edcfdae452a653ffb51a534ca4decd389952c225724ff3b94042612a6e',
 'vae/diffusion_pytorch_model.safetensors':'ca70d2202afe6415bdbcb8793ba8cd99fd159cfe6192381504d6c4d3036e0f04',
}

def environment(req):
    config=req['config'];model=Path(config.get('imageModel') or '')
    if not config.get('imageModel') or not model.is_dir():raise ValueError('NEEDS_PROVIDER: local image checkpoint missing')
    if not (model/'acs-manifest.json').is_file():raise ValueError('NEEDS_PROVIDER: finish installing and verifying the local image checkpoint first')
    manifest=json.loads((model/'acs-manifest.json').read_text(encoding='utf-8'))
    if manifest.get('repo')!='black-forest-labs/FLUX.2-klein-4B' or manifest.get('revision')!='e7b7dc27f91deacad38e78976d1f2b499d76a294':raise ValueError('Unsupported image checkpoint identity')
    inventory=[]
    for item in manifest['files']:
        file=model/item['path']
        if file.is_symlink() or not file.resolve().is_relative_to(model.resolve()):raise ValueError('Invalid image checkpoint path')
        with file.open('rb') as handle:actual=hashlib.file_digest(handle,'sha256').hexdigest()
        if actual!=item['sha256'] or file.stat().st_size!=item['bytes'] or item['path'] in PINNED_WEIGHTS and actual!=PINNED_WEIGHTS[item['path']]:raise ValueError('Image checkpoint corrupt: '+item['path'])
        inventory.append(dict(path=item['path'],sha256=actual,bytes=item['bytes']))
    paths={item['path'] for item in inventory}
    if len(inventory)!=20 or len(paths)!=20 or not set(PINNED_WEIGHTS).issubset(paths):raise ValueError('Incomplete image checkpoint manifest')
    state=dict(repo=manifest['repo'],revision=manifest['revision'],files=inventory,versions={name:metadata.version(name) for name in ('torch','diffusers','transformers','accelerate','safetensors','Pillow')},engine_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),lease_runner_sha256=hashlib.sha256(Path(__file__).with_name('runner.py').read_bytes()).hexdigest())
    return dict(fingerprint=hashlib.sha256(json.dumps(state,sort_keys=True).encode()).hexdigest(),**state)

def generate(req):
    prompt=req.get('prompt','');width=req.get('width',768);height=req.get('height',768);seed=req.get('seed',0)
    if not isinstance(prompt,str) or not 1<=len(prompt)<=2400:raise ValueError('Image prompt must contain 1-2400 characters')
    prompt=prompt.strip()
    if not prompt:raise ValueError('Image prompt is empty')
    if not all(isinstance(v,int) and 384<=v<=1536 and v%16==0 for v in (width,height)) or width*height>1048576:raise ValueError('Image dimensions must be multiples of 16, 384-1536, at most 1 megapixel')
    if not isinstance(seed,int) or not 0<=seed<=2147483647:raise ValueError('Invalid seed')
    if req['config'].get('imageDevice','cuda_cpu_offload')!='cuda_cpu_offload':raise ValueError('Unsupported image execution preset; never silently downgrade')
    evidence=environment(req);destination=Path(req['output']);destination.parent.mkdir(parents=True,exist_ok=True)
    if destination.exists():raise ValueError('Image output already exists; create a new immutable version')
    import torch
    from diffusers import Flux2KleinPipeline
    from PIL import PngImagePlugin
    started=time.time()
    with gpu_lease(req['config']):
        if not torch.cuda.is_available():raise ValueError('NEEDS_PROVIDER: CUDA is unavailable for this image preset')
        torch.cuda.reset_peak_memory_stats()
        pipe=Flux2KleinPipeline.from_pretrained(req['config']['imageModel'],torch_dtype=torch.bfloat16,local_files_only=True)
        pipe.enable_model_cpu_offload()
        image=pipe(prompt=prompt,width=width,height=height,num_inference_steps=4,guidance_scale=1.0,generator=torch.Generator(device='cuda').manual_seed(seed)).images[0].convert('RGB')
        peak=torch.cuda.max_memory_allocated()/1024**2
        png=PngImagePlugin.PngInfo();png.add_text('AI_generated','true');png.add_text('ACS_model_revision',evidence['revision']);png.add_text('ACS_seed',str(seed))
        temporary=destination.with_suffix('.partial.png');image.save(temporary,pnginfo=png);os.replace(temporary,destination)
        del pipe
        torch.cuda.empty_cache()
    with destination.open('rb') as handle:output_sha=hashlib.file_digest(handle,'sha256').hexdigest()
    return dict(engine='flux2-klein-4b',device='cuda',execution_mode='cuda_cpu_offload',dtype='bfloat16',width=width,height=height,seed=seed,steps=4,guidance_scale=1.0,seconds=time.time()-started,peak_vram_mib=peak,output=str(destination),output_sha256=output_sha,environment=evidence,synthetic=True,editorial_review='NOT_REVIEWED',factual_evidence=False)

def main():
    request=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
    try:
        if request['op']=='image-environment':result=environment(request)
        elif request['op']=='image':result=generate(request)
        else:raise ValueError('Unsupported image operation')
        print(json.dumps(result,ensure_ascii=False))
    except Exception as error:
        print(json.dumps(dict(error=str(error)),ensure_ascii=False));sys.exit(1)
if __name__=='__main__':main()
