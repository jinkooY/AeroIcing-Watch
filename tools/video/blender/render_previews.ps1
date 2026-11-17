# Low-resolution preview renders of the two Blender cloud shots, then mp4 previews with ffmpeg.
# Usage: powershell -File tools\video\blender\render_previews.ps1 [-Res 640x360] [-Samples 24] [-Fps 12] [-Seconds 6]
# Frames already rendered are skipped (Blender does not overwrite), so a rerun only fills the gaps.
param(
    [string]$Res = "640x360",
    [int]$Samples = 24,
    [int]$Fps = 12,
    [int]$Seconds = 6,
    [string]$Tag = "pv",
    [string]$Only = "",      # comma-separated frame numbers to render as a check, no mp4 then
    [string]$Pick = "A,B"     # which shots to render
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$blender = "$env:USERPROFILE\.cache\weatherpath-blender\blender-4.5.9-windows-x64\blender.exe"
$maps = "$root\data\video\blender\maps"
$out = "$root\data\video\blender\anim"
$frames = $Fps * $Seconds
# shot A: approach over the tops; shot B: the dip into the top layer (km along the route)
$shots = @(
    @{ name = "${Tag}_A_approach"; from = 440; to = 466; extra = @() },
    # the in-cloud fill light is on only while the camera is inside the deck (see cloud_dive_clouds.py --ambient-keys)
    @{ name = "${Tag}_B_dip"; from = 468; to = 486; extra = @("--ambient", "5", "--ambient-keys", "468:0,471.5:1") }
)
foreach ($s in $shots) {
    if (-not ($Pick.Split(",") | Where-Object { $s.name -like "*_$($_)_*" })) { continue }
    $onlyArgs = @(); if ($Only) { $onlyArgs = @("--only", $Only) }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    & $blender --background --factory-startup --python-exit-code 1 --python "$root\tools\video\blender\cloud_dive_clouds.py" -- `
        --maps $maps --out $out --mode anim --s-from $s.from --s-to $s.to --frames $frames --fps $Fps `
        --res $Res --samples $Samples --name $s.name @($s.extra) @onlyArgs 2>&1 | Select-String -Pattern "saved|Error|Traceback" | ForEach-Object { $_.Line }
    if ($LASTEXITCODE -ne 0) { throw "Blender failed on $($s.name)" }
    "{0}: {1:N0} s" -f $s.name, $sw.Elapsed.TotalSeconds
    if ($Only) { continue }
    $dir = "$out\$($s.name)"
    ffmpeg -y -loglevel error -framerate $Fps -i "$dir\f_%04d.png" -vf "deflicker=mode=pm:size=7,fps=24,format=yuv420p" -c:v libx264 -crf 18 "$out\$($s.name).mp4"
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed on $($s.name)" }
    "wrote $out\$($s.name).mp4"
}
