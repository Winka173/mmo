# Registers the Tủ Tò Mò worker as a per-user scheduled task that starts at logon and restarts on failure.
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
$pnpm = (Get-Command pnpm).Source
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$pnpm`" worker >> `"%LOCALAPPDATA%\TuToMoFactory\worker.log`" 2>&1" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 3650)
New-Item -ItemType Directory -Force -Path "$env:LOCALAPPDATA\TuToMoFactory" | Out-Null
Register-ScheduledTask -TaskName "TuToMoWorker" -Action $action -Trigger $trigger -Settings $settings -Description "Tu To Mo content factory worker" -Force | Out-Null
Start-ScheduledTask -TaskName "TuToMoWorker"
Write-Host "Da dang ky va khoi dong task TuToMoWorker. Log: $env:LOCALAPPDATA\TuToMoFactory\worker.log"
