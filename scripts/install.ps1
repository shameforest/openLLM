# openLLM: install or update everything on this Windows PC (first draft, test on the Shadow PC).
# Safe to run again; finished steps are skipped. Mirrors the OpenDali installer.
#
#   powershell -ExecutionPolicy Bypass -File C:\openLLM\scripts\install.ps1
#   powershell -ExecutionPolicy Bypass -File C:\openLLM\scripts\install.ps1 -SkipModel   # software only
#
# NOTE: every external command marked "VERIFY" below is from research, not yet run on Windows.
# The exact OpenCode config path and the Ollama tag are confirmed on the first real run.
param(
    [string]$Model = "qwen3.8:27b",   # the first local model (Apache-2.0); VERIFY the tag at ollama.com/library
    [switch]$SkipModel
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = Split-Path -Parent $PSScriptRoot
$Logs = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $Logs | Out-Null
$LogFile = Join-Path $Logs ("install-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
Start-Transcript -Path $LogFile | Out-Null

function Step($n, $t) { Write-Host ""; Write-Host "[$n/6] $t" -ForegroundColor Cyan }
function Ok($t)        { Write-Host "  OK  $t" -ForegroundColor Green }
function Fail($t) {
    Write-Host ""; Write-Host "FEHLER: $t" -ForegroundColor Red
    Write-Host "Bitte schick Claude diese Datei: $LogFile" -ForegroundColor Yellow
    Stop-Transcript | Out-Null; exit 1
}
function Refresh-Path {
    # Scoop adds ~\scoop\shims to the user PATH, but an already-open shell won't see it until restart;
    # add it explicitly so freshly installed tools (opencode) resolve within this run.
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                (Join-Path $HOME "scoop\shims")
}

Write-Host "openLLM Installation  (Protokoll: $LogFile)" -ForegroundColor White
Refresh-Path

# 1 -------------------------------------------------------------- Scoop (user-space package manager, no admin)
Step 1 "Scoop pruefen (Paketverwaltung ohne Administrator)"
if (-not (Get-Command scoop -ErrorAction SilentlyContinue)) {
    Write-Host "  Scoop wird installiert ..."
    try { Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force } catch {}
    Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
    Refresh-Path
    if (-not (Get-Command scoop -ErrorAction SilentlyContinue)) { Fail "Scoop konnte nicht installiert werden." }
}
Ok "scoop vorhanden"

# 2 -------------------------------------------------------------- OpenCode (the agent harness)
Step 2 "OpenCode einrichten (die Agenten-Huelle)"
# VERIFY: 'scoop install opencode' is listed on the OpenCode repo page (main bucket).
if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) {
    scoop install opencode
    Refresh-Path
    if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) {
        Fail "OpenCode wurde nicht installiert. Alternativen: 'choco install opencode' oder 'npm i -g @opencode/cli@latest'."
    }
} else {
    scoop update opencode 2>$null
}
# PowerShell: try/catch is a statement, not an expression — do it before the Ok line.
$ocVersion = ""
try { $ocVersion = (opencode --version 2>$null) } catch {}
Ok "opencode $ocVersion installiert (Version 1.x erwartet)"

# 3 -------------------------------------------------------------- Ollama (the model server)
Step 3 "Ollama einrichten (laesst das Modell auf der Grafikkarte laufen)"
# VERIFY: official per-user installer from ollama.com (Inno Setup, silent, no admin).
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    $setup = Join-Path $env:TEMP "OllamaSetup.exe"
    Write-Host "  Ollama wird geladen und installiert ..."
    Invoke-WebRequest -UseBasicParsing "https://ollama.com/download/OllamaSetup.exe" -OutFile $setup
    # /NORESTART and a hidden window so the installer's auto-launched Ollama app menu cannot grab this console.
    Start-Process -FilePath $setup -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART" -Wait -WindowStyle Hidden
    Start-Sleep -Seconds 2
    Refresh-Path
    if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
        Fail "Ollama wurde nicht installiert. Bitte OllamaSetup.exe von ollama.com einmal von Hand ausfuehren."
    }
}
Ok "ollama vorhanden"

# 4 -------------------------------------------------------------- Ollama settings for coding (big context)
Step 4 "Ollama fuer Programmieren einstellen"
# Coding tools need a large context (text the model sees at once). q8_0 KV cache halves its memory.
[Environment]::SetEnvironmentVariable("OLLAMA_CONTEXT_LENGTH", "65536", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_KV_CACHE_TYPE", "q8_0", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_FLASH_ATTENTION", "1", "User")
# OpenCode: a formal plan-then-approve gate (experimental in v1.x, CLII client only). Remove if it misbehaves.
[Environment]::SetEnvironmentVariable("OPENCODE_EXPERIMENTAL_PLAN_MODE", "1", "User")
Ok "Kontext 65536, KV-Cache q8_0, Plan-Modus gesetzt (wirkt nach Neustart von Ollama/OpenCode)"

# 5 -------------------------------------------------------------- the model
Step 5 "Modell herunterladen ($Model, ca. 18 GB)"
if ($SkipModel) {
    Ok "uebersprungen (-SkipModel)"
} else {
    # 'ollama pull' starts the local server itself if needed.
    ollama pull $Model
    if ($LASTEXITCODE -ne 0) { Fail "Modell-Download fehlgeschlagen. Erneut starten setzt ihn fort. Tag pruefen: ollama.com/library" }
    Ok "$Model vorhanden"
}

# 6 -------------------------------------------------------------- config + desktop shortcut
Step 6 "Konfiguration schreiben und Desktop-Symbol anlegen"
# VERIFY: OpenCode reads a global config at ~\.config\opencode\opencode.json (XDG-style). Confirm on first run.
$cfgDir = Join-Path $HOME ".config\opencode"
New-Item -ItemType Directory -Force -Path $cfgDir, (Join-Path $cfgDir "agents"), (Join-Path $cfgDir "commands"), (Join-Path $cfgDir "skills") | Out-Null
Copy-Item -Force (Join-Path $Root "config\opencode.json") $cfgDir
Copy-Item -Force (Join-Path $Root "config\AGENTS.md") $cfgDir
Copy-Item -Force (Join-Path $Root "config\agents\*.md") (Join-Path $cfgDir "agents")
Copy-Item -Force (Join-Path $Root "config\commands\*.md") (Join-Path $cfgDir "commands")
# Skills (each a folder with SKILL.md); the one shipped is batch-autopilot. Your own Claude Code skills from
# .claude/skills in a project also work unchanged, so they do not need to be copied here.
Copy-Item -Recurse -Force (Join-Path $Root "skills\*") (Join-Path $cfgDir "skills")
Ok "Konfiguration (opencode.json, AGENTS.md, Agenten, Befehle, Skills) nach $cfgDir kopiert"

$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut((Join-Path $desktop "openLLM.lnk"))
$lnk.TargetPath = "powershell.exe"
$lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"" + (Join-Path $Root "scripts\start.ps1") + "`""
$lnk.WorkingDirectory = $Root
$lnk.Save()
Ok "Symbol 'openLLM' liegt auf dem Desktop"

Write-Host ""
Write-Host "Fertig. Doppelklick auf 'openLLM' startet den Programmier-Assistenten." -ForegroundColor Green
Write-Host "Hinweis: Grafikspeicher wird mit OpenDali geteilt - beende OpenDali, bevor du openLLM nutzt." -ForegroundColor Yellow
Stop-Transcript | Out-Null
