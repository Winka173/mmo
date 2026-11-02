param([switch]$SkipWebBuild)
$ErrorActionPreference='Stop'
$acsRepo=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $acsRepo
$acsBuildMarker=Join-Path $acsRepo '.local/desktop-package.json'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $acsBuildMarker) | Out-Null
if(Test-Path -LiteralPath $acsBuildMarker){
  $acsPrior=Get-Content -LiteralPath $acsBuildMarker -Raw | ConvertFrom-Json
  if(Get-Process -Id $acsPrior.pid -ErrorAction SilentlyContinue){throw 'Another desktop packaging process is still running'}
  Remove-Item -LiteralPath $acsBuildMarker -Force
}
$acsBuildHandle=[IO.File]::Open($acsBuildMarker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{
$acsBuildBytes=[Text.Encoding]::UTF8.GetBytes((@{pid=$PID;started=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress))
$acsBuildHandle.Write($acsBuildBytes,0,$acsBuildBytes.Length);$acsBuildHandle.Flush();$acsBuildHandle.Dispose()
function Assert-Exit([string]$Label){if($LASTEXITCODE -ne 0){throw "$Label failed ($LASTEXITCODE)"}}
if(-not $env:CARGO_HOME){
  $acsExistingCargo=Join-Path $env:USERPROFILE 'Projects/Asset-Forge-Studio/.local/desktop-tools/cargo'
  if(Test-Path (Join-Path $acsExistingCargo 'bin/cargo.exe')){
    $env:CARGO_HOME=$acsExistingCargo
    $env:RUSTUP_HOME=Join-Path $env:USERPROFILE 'Projects/Asset-Forge-Studio/.local/desktop-tools/rustup'
  }
}
if($env:CARGO_HOME){$env:PATH="$env:CARGO_HOME\bin;$env:PATH"}
if(-not(Get-Command cargo -ErrorAction SilentlyContinue)){throw 'Rust toolchain required. Install Rust MSVC, or configure CARGO_HOME and RUSTUP_HOME.'}
if(-not $SkipWebBuild){& npx --yes pnpm@10.28.0 build;Assert-Exit 'TypeScript + Next production build'}
& node desktop/prepare.mjs;Assert-Exit 'Package Node, Next and worker'
New-Item -ItemType Directory -Force src-tauri/icons | Out-Null
if(-not(Test-Path src-tauri/icons/icon.ico)){
  Add-Type -AssemblyName System.Drawing
  $acsBitmap=New-Object Drawing.Bitmap 64,64
  $acsGraphics=[Drawing.Graphics]::FromImage($acsBitmap)
  $acsGraphics.Clear([Drawing.Color]::FromArgb(115,88,232))
  $acsFont=New-Object Drawing.Font 'Segoe UI',36,([Drawing.FontStyle]::Bold)
  $acsGraphics.DrawString('A',$acsFont,[Drawing.Brushes]::White,9,1)
  $acsIcon=[Drawing.Icon]::FromHandle($acsBitmap.GetHicon())
  $acsStream=[IO.File]::Create((Join-Path $acsRepo 'src-tauri/icons/icon.ico'))
  $acsIcon.Save($acsStream);$acsStream.Dispose();$acsGraphics.Dispose();$acsBitmap.Dispose()
}
& node_modules/.bin/tauri.cmd build --bundles nsis;Assert-Exit 'Tauri Windows executable + installer'
$acsOutput=Join-Path $acsRepo 'dist/windows'
New-Item -ItemType Directory -Force -Path $acsOutput | Out-Null
Copy-Item -LiteralPath src-tauri/target/release/autonomous-creative-studio.exe -Destination (Join-Path $acsOutput 'AUTONOMOUS CREATIVE STUDIO.exe')
& node scripts/stage-portable.mjs;Assert-Exit 'Stage exact portable resources'
Get-ChildItem src-tauri/target/release/bundle/nsis -Filter '*.exe' | Copy-Item -Destination $acsOutput
$acsArtifacts=Get-ChildItem -LiteralPath $acsOutput -Filter '*.exe' | ForEach-Object { @{file=$_.Name;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash} }
@{product='AUTONOMOUS CREATIVE STUDIO';built_utc=[DateTime]::UtcNow.ToString('o');artifacts=@($acsArtifacts);native_smoke='NOT_RUN';status='BUILT_PENDING_SMOKE'} | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $acsOutput 'build-report.json')
Write-Output "Built Windows application: $acsOutput"
}finally{
  $acsBuildHandle.Dispose()
  Remove-Item -LiteralPath $acsBuildMarker -Force -ErrorAction SilentlyContinue
}
