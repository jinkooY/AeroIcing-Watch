# Brightness check of a rendered shot: mean luma per frame, and every frame that drops darker than its neighbours.
# Usage: powershell -File tools\video\blender\flicker_check.ps1 -Path <frames dir or mp4> [-Fps 12] [-Limit 6]
# A "dip" is a frame darker than both neighbours by more than -Limit (0 to 255 scale); the check fails if any is found.
param(
    [Parameter(Mandatory = $true)][string]$Path,
    [int]$Fps = 12,
    [double]$Limit = 6
)
if (Test-Path $Path -PathType Container) { $inArgs = @("-framerate", "$Fps", "-i", (Join-Path $Path "f_%04d.png")) } else { $inArgs = @("-i", $Path) }
$v = ffmpeg -loglevel error @inArgs -vf "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null - 2>&1 |
    Select-String "YAVG" | ForEach-Object { [double]($_.Line -split "=")[1] }
$jump = 0; $dips = @()
for ($i = 1; $i -lt $v.Count; $i++) {
    $jump = [Math]::Max($jump, [Math]::Abs($v[$i] - $v[$i - 1]))
    if ($i -lt $v.Count - 1) {
        $drop = [Math]::Min($v[$i - 1], $v[$i + 1]) - $v[$i]
        if ($drop -gt $Limit) { $dips += "frame {0}: {1:N0} between {2:N0} and {3:N0}" -f ($i + 1), $v[$i], $v[$i - 1], $v[$i + 1] }
    }
}
"{0}: {1} frames, luma {2:N0} to {3:N0}, largest step {4:N1}, dips over {5}: {6}" -f (Split-Path $Path -Leaf), $v.Count,
    ($v | Measure-Object -Minimum).Minimum, ($v | Measure-Object -Maximum).Maximum, $jump, $Limit, $dips.Count
$dips
if ($dips.Count) { exit 1 }
