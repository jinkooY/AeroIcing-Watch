# Kiro PreToolUse hook: block writes to secrets and cached data.
# Protected: `.env` / `.env.local` at the repository root, and everything under the root `data/` folder.
# `.env.example` is allowed. Reads the hook JSON from stdin and inspects every "path"-like field.
# Exit 2 = block the tool call (stderr is shown to the agent), 0 = allow.
$raw = [Console]::In.ReadToEnd()
$fields = [regex]::Matches($raw, '"(?:path|file_path|targetFile)"\s*:\s*"([^"]*)"')
foreach ($m in $fields) {
    $p = ($m.Groups[1].Value -replace '\\\\', '/' -replace '\\', '/')
    $isEnv  = ($p -match '(^|/aeroicing-watch/)\.env(\.local)?$')
    $isData = ($p -match '(^|/aeroicing-watch/)data/')
    if ($isEnv -or $isData) {
        [Console]::Error.WriteLine("Blocked: '$p' is protected. The agent never writes .env or data/ (secrets and cached satellite data).")
        exit 2
    }
}
exit 0
