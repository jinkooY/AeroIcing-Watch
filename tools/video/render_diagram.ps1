# Render the five reveal stages of docs/video/assets/diagram.html to 1920x1080 PNGs in data/video/assets/.
# Uses a one-shot headless Edge (or Chrome) that exits by itself. Run from the repository root.
$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$browser = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw "No Edge or Chrome found." }
$out = Join-Path $root "data\video\assets"
New-Item -ItemType Directory -Force $out | Out-Null
$html = (Join-Path $root "docs\video\assets\diagram.html").Replace("\", "/")
$profile = Join-Path $env:TEMP "cloud-dive-diagram-profile"
foreach ($stage in 1..5) {
  $png = Join-Path $out "diagram-$stage.png"
  Remove-Item $png -ErrorAction SilentlyContinue
  $argList = @("--headless=new", "--disable-gpu", "--hide-scrollbars", "--user-data-dir=`"$profile`"", "--window-size=1920,1080", "--screenshot=`"$png`"", "`"file:///${html}?stage=$stage`"")
  Start-Process -FilePath $browser -ArgumentList $argList -Wait -NoNewWindow -RedirectStandardError (Join-Path $env:TEMP "diagram-err.txt")
  if (-not (Test-Path $png)) { throw "stage $stage was not rendered" }
  Write-Host "rendered $png"
}
