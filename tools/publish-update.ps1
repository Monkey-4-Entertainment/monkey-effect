param(
  [string]$Root = (Split-Path -Parent $MyInvocation.MyCommand.Path),
  [string]$Ver = "1.0.6.10",
  [string]$Notes = "Monkeyeffect 1.0.6.10 - launcher closes CMD window automatically",
  [string]$RepoRawBase = "https://raw.githubusercontent.com/Monkey-4-Entertainment/monkey-effect/main/update"
)

if ((Split-Path -Leaf $Root) -eq "tools") {
  $Root = Split-Path -Parent $Root
}
$Root = [System.IO.Path]::GetFullPath($Root.TrimEnd('\', '/'))

$ErrorActionPreference = "Stop"
$out = Join-Path $env:USERPROFILE "Desktop\Monkeyeffect-Update"
$stage = Join-Path $out "stage"
$zipName = "Monkeyeffect-$Ver-update.zip"
$zip = Join-Path $out $zipName
$json = Join-Path $out "latest.json"
$repoUpdate = Join-Path $Root "update"

Write-Host "[0/5] Sync version.json -> $Ver..."
$verPath = Join-Path $Root "wwwroot\version.json"
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($verPath, "{`r`n  `"version`": `"$Ver`"`r`n}`r`n", $utf8)

Write-Host "[1/5] Ensure DLL..."
$dllSrc = Join-Path $Root "decompiled\bin\Release\net10.0-windows\TempleGiftRelay.dll"
$dllDst = Join-Path $Root "TempleGiftRelay.dll"
if (-not (Test-Path $dllSrc)) { throw "Build DLL first (missing $dllSrc)" }
Copy-Item -Force $dllSrc $dllDst

Write-Host "[2/5] Stage update files..."
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force -Path (Join-Path $stage "wwwroot") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage "tools") | Out-Null
Copy-Item -Force $dllDst (Join-Path $stage "TempleGiftRelay.dll")
robocopy (Join-Path $Root "wwwroot") (Join-Path $stage "wwwroot") /E /XD media-cache /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
# Only ship runtime tools needed by the app (never innosetup / build helpers).
$toolsSrc = Join-Path $Root "tools"
$toolsDst = Join-Path $stage "tools"
New-Item -ItemType Directory -Force -Path $toolsDst | Out-Null
foreach ($f in @("tts-server.mjs","package.json","package-lock.json")) {
  $p = Join-Path $toolsSrc $f
  if (Test-Path $p) { Copy-Item -Force $p (Join-Path $toolsDst $f) }
}
$nm = Join-Path $toolsSrc "node_modules"
if (Test-Path $nm) {
  robocopy $nm (Join-Path $toolsDst "node_modules") /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
}
foreach ($f in @("Monkeyeffect.bat","Monkeyeffect.vbs","monkeyeffect.ico")) {
  $p = Join-Path $Root $f
  if (Test-Path $p) { Copy-Item -Force $p (Join-Path $stage $f) }
}

Write-Host "[3/5] Zip + latest.json..."
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
$zipUrl = "$RepoRawBase/$zipName"
$feedUrl = "$RepoRawBase/latest.json"
$obj = [ordered]@{
  version = $Ver
  notes = $Notes
  zipUrl = $zipUrl
  sha256 = $hash
  mandatory = $false
  repo = "https://github.com/Monkey-4-Entertainment/monkey-effect"
}
[System.IO.File]::WriteAllText($json, ($obj | ConvertTo-Json -Depth 5), $utf8)
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue

Write-Host "[4/5] Copy into repo update/ (for git push)..."
New-Item -ItemType Directory -Force -Path $repoUpdate | Out-Null
Copy-Item -Force $json (Join-Path $repoUpdate "latest.json")
Copy-Item -Force $json (Join-Path $repoUpdate "feed.json")
Copy-Item -Force $zip (Join-Path $repoUpdate $zipName)

$readme = @"
Monkeyeffect online update pack v$Ver

Repo: https://github.com/Monkey-4-Entertainment/monkey-effect

Feed URL (app default / update-feed.url):
$feedUrl

Zip URL:
$zipUrl

Upload steps:
1) git add update/latest.json update/$zipName
2) git commit -m "Publish update $Ver"
3) git push origin main
4) Open the feed URL in a browser to verify

Note: if the zip is too large for GitHub git (>100MB), use GitHub Releases and edit zipUrl in latest.json

Desktop files:
- $json
- $zip
sha256=$hash
"@
[System.IO.File]::WriteAllText((Join-Path $out "README.txt"), $readme, $utf8)
[System.IO.File]::WriteAllText((Join-Path $repoUpdate "README.txt"), $readme, $utf8)

Write-Host "[5/5] DONE: $out"
Write-Host "feed=$feedUrl"
Write-Host "sha256=$hash"
Get-ChildItem $out | Select-Object Name, Length | Format-Table -AutoSize
