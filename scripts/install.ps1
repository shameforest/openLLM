# OpenDante: install or update everything on this Windows PC (first draft, test on the Shadow PC).
# Safe to run again; finished steps are skipped. Mirrors the OpenDali installer.
#
#   powershell -ExecutionPolicy Bypass -File C:\openLLM\scripts\install.ps1
#   powershell -ExecutionPolicy Bypass -File C:\openLLM\scripts\install.ps1 -SkipModel   # software only
#
# NOTE: every external command marked "VERIFY" below is from research, not yet run on Windows.
# The exact OpenCode config path and the Ollama tag are confirmed on the first real run.
param(
    # Which local model to download. Empty = the default from config/models.json (the one model list of the app).
    # Another one from that list: -Model qwen3.8:27b
    [string]$Model = "",
    [switch]$SkipModel
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = Split-Path -Parent $PSScriptRoot
if (-not $Model) { $Model = (Get-Content -Raw (Join-Path $Root "config\models.json") | ConvertFrom-Json).default }
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

Write-Host "OpenDante Installation  (Protokoll: $LogFile)" -ForegroundColor White
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
    # Stay on OpenCode 1.x: version 2 changed the server API and config this app uses (opencode.ai/v2/docs/migrate-v1).
    # Scoop's "opencode" is 1.x today (v2 is "versions/opencode2"); if an update ever lands on 2.x, roll back.
    $before = ""
    try { $before = (opencode --version 2>$null) } catch {}
    scoop update opencode 2>$null
    $after = ""
    try { $after = (opencode --version 2>$null) } catch {}
    if ($after -and -not $after.StartsWith("1.") -and $before.StartsWith("1.")) {
        scoop reset "opencode@$before" 2>$null
        Write-Host "  OpenCode $after ist eine neue Hauptversion - zurueck auf $before (OpenDante braucht 1.x)." -ForegroundColor Yellow
    }
}
# PowerShell: try/catch is a statement, not an expression — do it before the Ok line.
$ocVersion = ""
try { $ocVersion = (opencode --version 2>$null) } catch {}
if ($ocVersion -and -not $ocVersion.StartsWith("1.")) { Fail "OpenCode $ocVersion ist installiert, OpenDante braucht Version 1.x." }
Ok "opencode $ocVersion installiert (Version 1.x)"

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
# Keep the model in the graphics card for 60 min after use, so resuming a chat does not reload the 18 GB each time
# (the app also keeps it warm and preloads on open; this is the belt-and-suspenders default).
[Environment]::SetEnvironmentVariable("OLLAMA_KEEP_ALIVE", "60m", "User")
# OpenCode: a formal plan-then-approve gate (experimental in v1.x, CLII client only). Remove if it misbehaves.
[Environment]::SetEnvironmentVariable("OPENCODE_EXPERIMENTAL_PLAN_MODE", "1", "User")
Ok "Kontext 65536, KV-Cache q8_0, Warmhalten 60m, Plan-Modus gesetzt (wirkt nach Neustart von Ollama/OpenCode)"

# 5 -------------------------------------------------------------- the model
Step 5 "Modell herunterladen ($Model, ca. 18 GB)"
if ($SkipModel) {
    Ok "uebersprungen (-SkipModel)"
} else {
    # 'ollama pull' starts the local server itself if needed.
    ollama pull $Model
    if ($LASTEXITCODE -ne 0) { Fail "Modell-Download fehlgeschlagen. Erneut starten setzt ihn fort. Namen pruefen auf ollama.com: $Model" }
    Ok "$Model vorhanden"
}

# 6 -------------------------------------------------------------- config + desktop shortcut
Step 6 "Konfiguration schreiben und Desktop-Symbol anlegen"
# VERIFY: OpenCode reads a global config at ~\.config\opencode\opencode.json (XDG-style). Confirm on first run.
$cfgDir = Join-Path $HOME ".config\opencode"
New-Item -ItemType Directory -Force -Path $cfgDir, (Join-Path $cfgDir "agents"), (Join-Path $cfgDir "commands"), (Join-Path $cfgDir "skills") | Out-Null
# opencode.json — keep a user-added Anthropic key (the companion writes it) across updates
$ocTarget = Join-Path $cfgDir "opencode.json"
$ocBackup = "$ocTarget.vorher"
$keepAnthropic = $null
if (Test-Path $ocTarget) {
    try { $keepAnthropic = (Get-Content -Raw -Encoding UTF8 $ocTarget | ConvertFrom-Json).provider.anthropic } catch {}
    Copy-Item -Force $ocTarget $ocBackup
}
Copy-Item -Force (Join-Path $Root "config\opencode.json") $cfgDir
if ($keepAnthropic) {
    $oc = Get-Content -Raw -Encoding UTF8 $ocTarget | ConvertFrom-Json
    $oc.provider | Add-Member -NotePropertyName anthropic -NotePropertyValue $keepAnthropic -Force
    $oc | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $ocTarget
}
# Let OpenCode itself load the new file. Valid JSON is not enough: a key OpenCode does not know inside a block (for
# example a comment inside "permission") makes the whole config invalid and OpenCode refuses to start.
$old = $ErrorActionPreference; $ErrorActionPreference = "Continue"
$ocCheck = & opencode models ollama 2>&1 | Out-String
$ocOk = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $old
if (-not $ocOk) {
    if (Test-Path $ocBackup) { Copy-Item -Force $ocBackup $ocTarget }
    Write-Host ($ocCheck -replace '\x1b\[[0-9;]*m', '')
    Fail "Die neue OpenCode-Konfiguration ist ungueltig; die bisherige wurde wiederhergestellt."
}
Ok "OpenCode-Konfiguration geprueft (opencode models)"
# AGENTS.md — keep the user's global-instructions block (the companion writes it) across updates
$agTarget = Join-Path $cfgDir "AGENTS.md"
$userBlock = ""
# Read and write as UTF-8 explicitly: the companion writes the file without a BOM, and Windows PowerShell 5.1 would
# read it as ANSI, so every update turned "ö" in the user's German instructions into "Ã¶" (AN-03).
$utf8 = New-Object System.Text.UTF8Encoding($false)
if (Test-Path $agTarget) {
    $m = [regex]::Match([IO.File]::ReadAllText($agTarget, $utf8), '(?s)<!-- OPENDANTE-USER-START -->.*?<!-- OPENDANTE-USER-END -->')
    if ($m.Success) { $userBlock = "`r`n`r`n" + $m.Value + "`r`n" }
}
Copy-Item -Force (Join-Path $Root "config\AGENTS.md") $cfgDir
if ($userBlock) { [IO.File]::AppendAllText($agTarget, $userBlock, $utf8) }
Copy-Item -Force (Join-Path $Root "config\agents\*.md") (Join-Path $cfgDir "agents")
Copy-Item -Force (Join-Path $Root "config\commands\*.md") (Join-Path $cfgDir "commands")
# Skills (each a folder with SKILL.md); shipped: batch-autopilot. Skills uploaded in the app also land here. The
# launcher hides Claude-Code skills (~/.claude/skills, project .claude/skills) and ~/.agents/skills from the local model
# (they cost ~8.000 tokens per request); to use one here, upload it in Einstellungen -> Skills.
Copy-Item -Recurse -Force (Join-Path $Root "skills\*") (Join-Path $cfgDir "skills")
Ok "Konfiguration (opencode.json, AGENTS.md, Agenten, Befehle, Skills) nach $cfgDir kopiert"

# ---- build the web UI (the companion serves it as the app window) ----
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { scoop install nodejs-lts 2>$null; Refresh-Path }
if (Get-Command npm -ErrorAction SilentlyContinue) {
    Write-Host "  Oberflaeche wird gebaut (kann 1-2 Minuten dauern) ..."
    $buildLog = Join-Path $Logs "web-build.log"
    $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"   # the test browser is not needed on this PC
    $old = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    Push-Location (Join-Path $Root "web")
    npm install --no-audit --no-fund *> $buildLog
    npm run build *>> $buildLog
    Pop-Location
    $ErrorActionPreference = $old
    if (Test-Path (Join-Path $Root "web\dist\index.html")) { Ok "Oberflaeche gebaut" }
    else {
        Write-Host "  FEHLER beim Bauen der Oberflaeche. Letzte Zeilen ($buildLog):" -ForegroundColor Yellow
        Get-Content $buildLog -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" }
        Write-Host "  (Der Terminal-Modus funktioniert trotzdem: start.ps1 -Terminal.)" -ForegroundColor Yellow
    }
} else {
    Write-Host "  Hinweis: Node/npm fehlt; Oberflaeche nicht gebaut." -ForegroundColor Yellow
}

$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut((Join-Path $desktop "OpenDante.lnk"))
$lnk.TargetPath = "powershell.exe"
$lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"" + (Join-Path $Root "scripts\start.ps1") + "`""
$lnk.WorkingDirectory = $Root
$lnk.Save()
Ok "Symbol 'OpenDante' liegt auf dem Desktop"

Write-Host ""
Write-Host "Fertig. Doppelklick auf 'OpenDante' startet den Programmier-Assistenten." -ForegroundColor Green
Write-Host "Hinweis: Grafikspeicher wird mit OpenDali geteilt - beende OpenDali, bevor du OpenDante nutzt." -ForegroundColor Yellow
Stop-Transcript | Out-Null
