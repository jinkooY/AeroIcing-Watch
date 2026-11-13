# Kiro hook: run `node --check` on the JavaScript file that was just saved.
# Reads the hook JSON from stdin (field: file_path). Exit 0 = ok or not applicable, 1 = syntax error.
$raw = [Console]::In.ReadToEnd()
try { $payload = $raw | ConvertFrom-Json } catch { exit 0 }
$file = $payload.file_path
if (-not $file -or $file -notmatch '\.(js|mjs)$' -or $file -match '[\\/](vendor|node_modules)[\\/]') { exit 0 }
if (-not (Test-Path -LiteralPath $file)) { exit 0 }
node --check $file
if ($LASTEXITCODE -ne 0) {
    [Console]::Error.WriteLine("node --check failed: $file")
    exit 1
}
exit 0
