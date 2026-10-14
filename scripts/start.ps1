# OpenDante: start the model server, the OpenCode engine, the companion, then open the app window.
# Started by the desktop shortcut. -Terminal opens the OpenCode terminal app instead of the web window.
param([switch]$Terminal)
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" +
            [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + (Join-Path $HOME "scoop\shims")

Add-Type -AssemblyName System.Windows.Forms
function Note($t) { [System.Windows.Forms.MessageBox]::Show($t, "OpenDante") | Out-Null }
function Up($port) { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }

# The GPU holds only one big model at a time: OpenDali's image engine (port 8188) must not run alongside the LLM.
if (Up 8188) {
    $r = [System.Windows.Forms.MessageBox]::Show(
        "OpenDali (Bildgenerator) laeuft gerade und belegt die Grafikkarte. Zuerst beenden?`n`nJa = OpenDali beenden und fortfahren.",
        "OpenDante", "YesNo")
    if ($r -eq "Yes") { & (Join-Path (Split-Path $Root) "AI\scripts\stop.ps1") 2>$null }
}

# Model server (Ollama).
if (-not (Up 11434)) {
    $ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
    if (-not $ollama) { Note "Ollama wurde nicht gefunden. Bitte scripts\install.ps1 ausfuehren."; exit 1 }
    Start-Process -WindowStyle Hidden -FilePath $ollama -ArgumentList "serve"
}

# Where the agent works. The OpenCode server runs here, so files land in this folder.
$work = Join-Path $HOME "code"
New-Item -ItemType Directory -Force -Path $work | Out-Null

# OpenCode engine server (the chat API the UI talks to, port 4096).
if (-not (Up 4096)) {
    $opencode = (Get-Command opencode -ErrorAction SilentlyContinue).Source
    if (-not $opencode) { Note "OpenCode wurde nicht gefunden. Bitte scripts\install.ps1 ausfuehren."; exit 1 }
    Start-Process -WindowStyle Hidden -FilePath $opencode -ArgumentList "serve", "--port", "4096" -WorkingDirectory $work
}

if ($Terminal) {
    $opencode = (Get-Command opencode -ErrorAction SilentlyContinue).Source
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-NoProfile", "-Command", "Set-Location '$work'; & '$opencode'"
    exit 0
}

# Companion: serves the web UI and runs the settings/updates (port 4097).
if (-not (Up 4097)) {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) { Note "Node wurde nicht gefunden. Bitte scripts\install.ps1 ausfuehren (oder starte mit -Terminal)."; exit 1 }
    $env:OPENDANTE_ROOT = $Root
    Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList (Join-Path $Root "companion\server.mjs") -WorkingDirectory $Root
}

# Wait for the app to answer, then open it as its own window.
$deadline = (Get-Date).AddSeconds(30)
while (-not (Up 4097)) { if ((Get-Date) -gt $deadline) { Note "Der OpenDante-Dienst startet nicht."; exit 1 }; Start-Sleep -Milliseconds 400 }

$AppUrl = "http://127.0.0.1:4097"
$candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($browser) { Start-Process -FilePath $browser -ArgumentList "--app=$AppUrl", "--window-size=1400,920" }
else { Start-Process $AppUrl }
