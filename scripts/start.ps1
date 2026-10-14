# OpenDante: make sure the model server runs, then open the coding agent. Started by the desktop shortcut.
# -Serve: start the OpenCode web server instead of the terminal app (web UI comes in M5).
param([switch]$Serve)
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot

$env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" +
            [Environment]::GetEnvironmentVariable("Path", "Machine")

Add-Type -AssemblyName System.Windows.Forms
function Note($t) { [System.Windows.Forms.MessageBox]::Show($t, "OpenDante") | Out-Null }

# The GPU holds only one big model at a time: OpenDali's image engine (port 8188) must not run alongside the LLM.
$busy = Get-NetTCPConnection -LocalPort 8188 -State Listen -ErrorAction SilentlyContinue
if ($busy) {
    $r = [System.Windows.Forms.MessageBox]::Show(
        "OpenDali (Bildgenerator) laeuft gerade und belegt die Grafikkarte. Zuerst beenden?`n`nJa = OpenDali beenden und fortfahren.",
        "OpenDante", "YesNo")
    if ($r -eq "Yes") { & (Join-Path (Split-Path $Root) "AI\scripts\stop.ps1") 2>$null }
}

# Model server (Ollama). The Windows app usually autostarts; start it if the port is closed.
if (-not (Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue)) {
    $ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
    if (-not $ollama) { Note "Ollama wurde nicht gefunden. Bitte scripts\install.ps1 ausfuehren."; exit 1 }
    Start-Process -WindowStyle Hidden -FilePath $ollama -ArgumentList "serve"
    for ($i = 0; $i -lt 30; $i++) {
        if (Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue) { break }
        Start-Sleep -Milliseconds 500
    }
}

# Where you code. A dedicated folder so the agent has a home; change it to any project you like.
$work = Join-Path $HOME "code"
New-Item -ItemType Directory -Force -Path $work | Out-Null

$opencode = (Get-Command opencode -ErrorAction SilentlyContinue).Source
if (-not $opencode) { Note "OpenCode wurde nicht gefunden. Bitte scripts\install.ps1 ausfuehren."; exit 1 }

if ($Serve) {
    # Web UI (M5): start the server and open the browser. VERIFY the exact subcommand/flags against the installed version.
    Start-Process -FilePath $opencode -ArgumentList "serve" -WorkingDirectory $work
} else {
    # Terminal app in its own window.
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NoExit", "-NoProfile", "-Command", "Set-Location '$work'; & '$opencode'"
}
