param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$acsRoot=[System.IO.Path]::GetFullPath($Destination).TrimEnd('\')
if(Test-Path -LiteralPath $acsRoot){throw 'Extraction destination must be new'}
$acsZip=[System.IO.Compression.ZipFile]::OpenRead($Archive)
try {
 $acsSeen=New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
 $acsBytes=0L
 if($acsZip.Entries.Count -gt 20000){throw 'Unexpected archive entry count'}
 # Validate every entry before writing any file. Fixed official archive hash is verified by the caller.
 foreach($acsEntry in $acsZip.Entries){
  $acsName=$acsEntry.FullName.Replace('/','\')
  if([string]::IsNullOrWhiteSpace($acsName) -or [System.IO.Path]::IsPathRooted($acsName) -or $acsName.Contains(':') -or @($acsName.Split('\') | Where-Object {$_ -eq '..'}).Count -gt 0){throw 'Unsafe runtime archive path'}
  $acsTarget=[System.IO.Path]::GetFullPath([System.IO.Path]::Combine($acsRoot,$acsName))
  if(-not $acsTarget.StartsWith($acsRoot+'\',[System.StringComparison]::OrdinalIgnoreCase)){throw 'Runtime archive escapes destination'}
  if(-not $acsSeen.Add($acsTarget)){throw 'Duplicate runtime archive path'}
  $acsType=($acsEntry.ExternalAttributes -shr 16) -band 61440
  if($acsType -eq 40960){throw 'Runtime archive symlink rejected'}
  $acsBytes+=$acsEntry.Length
  if($acsBytes -gt 17179869184){throw 'Unexpected expanded runtime size'}
 }
 [System.IO.Directory]::CreateDirectory($acsRoot) | Out-Null
 foreach($acsEntry in $acsZip.Entries){
  $acsTarget=[System.IO.Path]::GetFullPath([System.IO.Path]::Combine($acsRoot,$acsEntry.FullName.Replace('/','\')))
  if($acsEntry.FullName.EndsWith('/')){[System.IO.Directory]::CreateDirectory($acsTarget) | Out-Null;continue}
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($acsTarget)) | Out-Null
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($acsEntry,$acsTarget,$false)
 }
 Write-Output ('Extracted '+$acsZip.Entries.Count+' verified-path entries')
} finally {$acsZip.Dispose()}
