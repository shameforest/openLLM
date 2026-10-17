# Keep the INSTALLED OpenCode config (~/.config/opencode/opencode.json, the one the running OpenCode reads) in sync with
# the repo's config/opencode.json. Without this, a repo config change (e.g. OD-37 image support) only reached OpenCode
# when install.ps1 was re-run — a normal restart via the desktop icon kept the stale config, so the local models still
# reported attachment:false and silently dropped attached images ("the model can't read images"). OD-72.
#
# TEXT-ONLY on purpose: do NOT ConvertFrom-Json the config. Windows PowerShell 5.1's ConvertFrom-Json treats object keys
# case-insensitively and throws "duplicate keys" on the config's case-only-different bash rules ("git branch -D*" vs
# "git branch -d*"), although OpenCode itself parses it fine. So we copy the repo text and only localize the MCP path.
# The Claude key is NOT kept here: it lives in ~/.opendante/claude-key.json (the companion reads it there and strips any
# anthropic block from opencode.json). The repo config has no anthropic block, so copying it is exactly what we want.
#
# Gated by a SHA-256 hash of the repo config, so it only rewrites the file — and thus only makes start.ps1 restart
# OpenCode (its $cfgNewer check) — when the repo config actually changed. Validates with `opencode models` and rolls back
# if OpenCode rejects the result.
#
# Exit code: 0 = ok (unchanged or updated); 2 = tried to update but the result was invalid and the previous config was
# kept. Prints one status line. Called by start.ps1 on every launch.
param(
    [Parameter(Mandatory)][string]$Root,
    [string]$OpenCode = "opencode",                              # resolved opencode.exe; caller passes its path
    [string]$CfgDir = (Join-Path $HOME ".config\opencode")       # overridable for tests
)

$repoCfg = Join-Path $Root "config\opencode.json"
$target  = Join-Path $CfgDir "opencode.json"
$sigFile = Join-Path $Root "logs\opencode-config.txt"
$utf8    = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $repoCfg)) { Write-Output "sync-config: repo config missing, skipped"; exit 0 }
New-Item -ItemType Directory -Force -Path $CfgDir, (Join-Path $Root "logs") | Out-Null

# Hash gate: only act when the repo config changed since the last successful sync (no needless OpenCode restart).
$repoHash = (Get-FileHash -Algorithm SHA256 $repoCfg).Hash
$lastHash = if (Test-Path $sigFile) { (Get-Content -Raw $sigFile).Trim() } else { "" }
if (($repoHash -eq $lastHash) -and (Test-Path $target)) { Write-Output "sync-config: unchanged"; exit 0 }

# Build the target text from the repo config, localizing only the committed MCP path to this install's folder.
$raw = [IO.File]::ReadAllText($repoCfg, $utf8)
$mcpPath = (Join-Path $Root "companion\claude-mcp.mjs")
$raw = $raw -replace [regex]::Escape('C:\\openLLM\\companion\\claude-mcp.mjs'), ($mcpPath -replace '\\', '\\')
if (Test-Path $target) { Copy-Item -Force $target "$target.vorher" }
[IO.File]::WriteAllText($target, $raw, $utf8)

# Valid JSON is not enough: a key OpenCode does not know inside a block invalidates the whole config and OpenCode refuses
# to start. Let OpenCode itself check it; roll back to the previous config on failure.
$old = $ErrorActionPreference; $ErrorActionPreference = "Continue"
$check = & $OpenCode models ollama 2>&1 | Out-String
$ok = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $old
if (-not $ok) {
    if (Test-Path "$target.vorher") { Copy-Item -Force "$target.vorher" $target }
    Write-Output ("sync-config: INVALID, kept previous`n" + ($check -replace '\x1b\[[0-9;]*m', '').Trim())
    exit 2
}
Set-Content -Path $sigFile -Value $repoHash -Encoding ascii
Write-Output "sync-config: updated"
exit 0
