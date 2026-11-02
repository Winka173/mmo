param([switch]$SkipVoices)
$ErrorActionPreference='Stop'
$acsWorkspace=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$acsInstaller=Join-Path $acsWorkspace 'dist/windows/AUTONOMOUS CREATIVE STUDIO_0.2.0_x64-setup.exe'
$acsFolder=([string][char]0x1EE8)+'ng d'+([string][char]0x1EE5)+'ng ACS'
if($env:ACS_SMOKE_FRESH_INSTALL -eq '1'){
  # Explicit fresh-directory acceptance; does not claim in-place upgrade cleanup.
  $acsFolder+='-'+(Get-FileHash -LiteralPath $acsInstaller -Algorithm SHA256).Hash.Substring(0,8).ToLowerInvariant()
}
$acsTarget=[IO.Path]::GetFullPath((Join-Path $acsWorkspace ".local/installed-smoke/$acsFolder"))
if(-not $acsTarget.StartsWith($acsWorkspace+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Smoke install target must remain inside the workspace'}
if(-not(Test-Path -LiteralPath $acsInstaller)){throw 'Build the current NSIS installer first'}
# Own current-user test installation only. Silent NSIS /D consumes the remaining path,
# including spaces; it must be the last argument and must not be wrapped in quotes.
$acsProcess=Start-Process -FilePath $acsInstaller -ArgumentList "/S /D=$acsTarget" -WindowStyle Hidden -PassThru -Wait
if($acsProcess.ExitCode -ne 0){throw "Installer returned $($acsProcess.ExitCode)"}
$acsExe=Join-Path $acsTarget 'autonomous-creative-studio.exe'
if(-not(Test-Path -LiteralPath $acsExe)){throw "Installed executable missing: $acsExe"}
@{status='INSTALLED_PENDING_LAUNCH';target=$acsTarget;exe=$acsExe;installerSha256=(Get-FileHash -LiteralPath $acsInstaller -Algorithm SHA256).Hash;exitCode=$acsProcess.ExitCode;at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $acsWorkspace 'docs/evidence/acs-install.json')
$env:ACS_SMOKE_EXE=$acsExe
$env:ACS_SMOKE_VOICES=if($SkipVoices){'0'}else{'1'}
& node (Join-Path $acsWorkspace 'desktop/smoke.mjs')
if($LASTEXITCODE -ne 0){throw "Installed native smoke failed ($LASTEXITCODE)"}
