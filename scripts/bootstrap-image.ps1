$ErrorActionPreference='Stop'
$acsRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $acsRoot
$acsUv=Join-Path $env:LOCALAPPDATA 'Programs/Python/Python311/Scripts/uv.exe'
$acsBasePython=Join-Path $env:LOCALAPPDATA 'Programs/Python/Python311/python.exe'
$acsImageEnv=Join-Path $acsRoot '.local/engines/image'
$acsImagePython=Join-Path $acsImageEnv 'Scripts/python.exe'
if(-not(Test-Path -LiteralPath $acsImagePython)){
 & $acsUv venv --python $acsBasePython $acsImageEnv
 if($LASTEXITCODE -ne 0){throw 'Image Python environment creation failed'}
}
& $acsUv pip install --python $acsImagePython 'torch==2.8.0+cu128' --index-url https://download.pytorch.org/whl/cu128
if($LASTEXITCODE -ne 0){throw 'CUDA PyTorch installation failed'}
& $acsUv pip install --python $acsImagePython 'diffusers==0.38.0' 'transformers==4.57.6' 'accelerate==1.12.0' 'huggingface-hub==0.36.2' 'safetensors==0.8.0' 'Pillow==12.3.0' 'numpy==2.4.6'
if($LASTEXITCODE -ne 0){throw 'Pinned image runtime installation failed'}
& $acsImagePython -c 'from diffusers import Flux2KleinPipeline; import torch; print(Flux2KleinPipeline.__name__,torch.__version__,torch.cuda.is_available())'
if($LASTEXITCODE -ne 0){throw 'Image pipeline import failed'}
& $acsUv pip freeze --python $acsImagePython | Set-Content -Encoding utf8 (Join-Path $acsRoot 'engines/requirements-image.lock.txt')
if($LASTEXITCODE -ne 0){throw 'Image runtime inventory failed'}
