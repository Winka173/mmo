param([switch]$Apply)
$ErrorActionPreference='Stop'
$acsWorkspace=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd([IO.Path]::DirectorySeparatorChar)
$acsPrefix=$acsWorkspace+[IO.Path]::DirectorySeparatorChar
function Assert-WorkspacePath([string]$Path){
 $full=[IO.Path]::GetFullPath($Path)
 if(-not $full.StartsWith($acsPrefix,[StringComparison]::OrdinalIgnoreCase)){throw "Cleanup target escapes workspace: $full"}
 return $full
}
function Assert-OrdinaryParents([string]$Path){
 $current=Assert-WorkspacePath $Path
 while($current -ne $acsWorkspace){
  if(Test-Path -LiteralPath $current){$item=Get-Item -LiteralPath $current -Force;if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Cleanup root/parent is a link: $current"}}
  $current=[IO.Path]::GetDirectoryName($current)
 }
}
# These are generated fixture trees, never the app's default LocalAppData store.
$acsLocalFixtures=@('backup-ui','benchmarks','build-folder-safety','crash-resume','create-ui','e2e-studio','expansion-ui','export-ui','features-ui','feed-discovery','feed-ui','footage-benchmark','frame-speech','image-benchmark','image-ui','improvements-first-package','improvements-speech','installed-smoke','llm-setup','localization-e2e','management-ui','media-intelligence','native-smoke','p0-repair-e2e','p0-setup-preflight','p0-ui','p0-voice','product-e2e','research-e2e','restore-crash','restore-native','semantic-e2e','semantic-ui','shorts-e2e','source-watch-e2e','startup-failure-smoke','timeline-e2e','ui-smoke-data','vad-benchmark','vad-production','vad-ui','worker-health-ui','workflow-ui')
$acsTargets=New-Object 'System.Collections.Generic.List[string]'
foreach($name in $acsLocalFixtures){$acsTargets.Add((Join-Path $acsWorkspace ".local/$name"))}
foreach($relative in @('src-tauri/target','apps/web/.next','apps/web/tsconfig.tsbuildinfo','desktop/backend','desktop/runtime','desktop/engines','engines/__pycache__','coverage','.turbo','.test-results.json')){$acsTargets.Add((Join-Path $acsWorkspace $relative))}
foreach($file in Get-ChildItem -LiteralPath (Join-Path $acsWorkspace '.local') -File -Force){
 if($file.Name -match '^(acs-.*\.json(?:\.bak)?|alignment-.*\.json|desktop-current-build\.log|llm-vision-check\.log|ux-shell-tsconfig\.json|e2e-frame\.jpg|image-seek-probe\.mp4|improvements-brand-cta-preview\.png)$'){$acsTargets.Add($file.FullName)}
}
foreach($file in Get-ChildItem -LiteralPath (Join-Path $acsWorkspace 'docs/evidence') -File -Force){
 if($file.Extension -in @('.png','.jpg','.jpeg','.webp','.log','.html','.bak')){$acsTargets.Add($file.FullName)}
}
# Only incomplete Hugging Face transfers; installed weights and manifests remain intact.
$acsModelCache=Join-Path $acsWorkspace '.local/models/flux2-klein-4b/.cache/huggingface/download/text_encoder'
if(Test-Path -LiteralPath $acsModelCache){foreach($file in Get-ChildItem -LiteralPath $acsModelCache -File -Filter '*.incomplete'){$acsTargets.Add($file.FullName)}}
$acsActive=Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|python|autonomous-creative-studio|ollama|cargo|rustc|makensis)' -and (($_.ExecutablePath -and $_.ExecutablePath.StartsWith($acsPrefix,[StringComparison]::OrdinalIgnoreCase)) -or ($_.CommandLine -and ($_.CommandLine.Contains($acsWorkspace) -or $_.CommandLine.Contains($acsWorkspace.Replace('\','/'))))) }
if($acsActive){$acsActive | Select-Object ProcessId,Name | Format-Table | Out-String | Write-Output;throw 'Close active ACS development/test processes before cleanup; no processes were terminated'}
$acsRows=New-Object 'System.Collections.Generic.List[object]'
function Measure-OrdinaryTree([string]$Path){
 $item=Get-Item -LiteralPath $Path -Force
 if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){return [long]0}
 if(-not $item.PSIsContainer){return [long]$item.Length}
 [long]$size=0
 foreach($entry in [IO.Directory]::EnumerateFileSystemEntries($Path)){$size+=Measure-OrdinaryTree $entry}
 return $size
}
foreach($target in ($acsTargets | Sort-Object -Unique)){
 $full=Assert-WorkspacePath $target
 if(-not(Test-Path -LiteralPath $full)){continue}
 Assert-OrdinaryParents $full
 $relative=$full.Substring($acsPrefix.Length)
 if($relative -eq '.local' -or $relative -match '^\.local[\\/](engines|tools)([\\/]|$)' -or $relative -match '^dist([\\/]|$)' -or $relative -match '^\.git([\\/]|$)'){throw "Protected cleanup root: $relative"}
 if($relative -match '^\.local[\\/]models[\\/]' -and -not $relative.EndsWith('.incomplete')){throw "Installed model deletion refused: $relative"}
 $acsRows.Add([PSCustomObject]@{path=$relative;bytes=(Measure-OrdinaryTree $full)})
}
$acsReport=Join-Path $acsWorkspace 'docs/CLEANUP_REPORT.json'
$acsBeforeFree=(Get-PSDrive -Name C).Free
$acsResult=[ordered]@{at=[DateTime]::UtcNow.ToString('o');status=if($Apply){'IN_PROGRESS'}else{'PLAN_ONLY'};workspace=$acsWorkspace;plannedBytes=($acsRows | Measure-Object bytes -Sum).Sum;deletedBytes=0;removed=@();errors=@();protected=@('.git','source and tests','fixtures','package manifests and lockfiles','node_modules','.local/models installed checkpoints','.local/engines','.local/tools','dist/windows current release','LocalAppData user data and credentials');targets=$acsRows.ToArray()}
$acsResult | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $acsReport -Encoding UTF8
$acsRows | Sort-Object bytes -Descending | Select-Object -First 15 path,@{Name='GiB';Expression={[Math]::Round($_.bytes/1GB,3)}} | Format-Table | Out-String | Write-Output
Write-Output ("Planned reclaim: {0:N3} GiB" -f ($acsResult.plannedBytes/1GB))
if(-not $Apply){return}
# Native PowerShell/.NET only. Never recurse through a junction or symlink.
function Remove-GeneratedTree([string]$Path){
 $full=Assert-WorkspacePath $Path
 $item=Get-Item -LiteralPath $full -Force
 if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){if($item.PSIsContainer){[IO.Directory]::Delete($full,$false)}else{[IO.File]::Delete($full)};return}
 if($item.PSIsContainer){foreach($entry in @([IO.Directory]::EnumerateFileSystemEntries($full))){Remove-GeneratedTree $entry};[IO.Directory]::Delete($full,$false)}else{if($item.IsReadOnly){$item.IsReadOnly=$false};[IO.File]::Delete($full)}
}
foreach($row in $acsRows){
 try{$full=Assert-WorkspacePath (Join-Path $acsWorkspace $row.path);Assert-OrdinaryParents $full;Remove-GeneratedTree $full;$acsResult.removed+=@($row.path);$acsResult.deletedBytes+=$row.bytes}
 catch{$acsResult.errors+=@([PSCustomObject]@{path=$row.path;error=$_.Exception.Message})}
}
$acsResult.status=if($acsResult.errors.Count){'PARTIAL_CLEANUP'}else{'COMPLETED'}
$acsResult.completedAt=[DateTime]::UtcNow.ToString('o')
$acsResult.freeDiskIncreaseBytes=(Get-PSDrive -Name C).Free-$acsBeforeFree
$acsResult | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $acsReport -Encoding UTF8
Write-Output ("{0}: removed {1} targets, {2:N3} GiB logical bytes" -f $acsResult.status,$acsResult.removed.Count,($acsResult.deletedBytes/1GB))
if($acsResult.errors.Count){$acsResult.errors | Format-Table | Out-String | Write-Output;exit 1}
