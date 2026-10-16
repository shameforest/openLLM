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

# The GPU holds only one big model at a time: OpenDali's image engine (ComfyUI on 8188 + its server on 3790) must not
# run alongside the LLM. It often lingers as a hidden background process from an earlier OpenDali session (closing the
# window does not stop it), which is why this can fire even when no OpenDali window is open. If the user agrees, free
# the GPU by its PORTS — that works no matter where OpenDali is installed, so there is no missing-stop-script error.
if (Up 8188) {
    $r = [System.Windows.Forms.MessageBox]::Show(
        "OpenDali (sein Bild-Motor ComfyUI) laeuft noch im Hintergrund und belegt die Grafikkarte.`n`nJa = OpenDali beenden und mit OpenDante fortfahren.",
        "OpenDante", "YesNo")
    if ($r -eq "Yes") {
        # Prefer OpenDali's own stop script (clean shutdown) if we can locate it; otherwise stop the ports directly.
        $stopped = $false
        foreach ($root in @($env:OPENDALI_ROOT, (Join-Path (Split-Path $Root) 'AI'), 'C:\ai', 'C:\OpenDali')) {
            if ($root) { $s = Join-Path $root 'scripts\stop.ps1'; if (Test-Path $s) { & $s | Out-Null; $stopped = $true; break } }
        }
        if (-not $stopped) {
            foreach ($port in 8188, 3790) {
                Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
                    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
            }
        }
        Start-Sleep -Milliseconds 500
    }
}

# Model server (Ollama).
# A killed or crashed Ollama leaves its model runners (llama-server.exe) behind, still holding the graphics memory
# (seen 2026-10-16: 17 GB held by a runner whose Ollama was gone; the next load failed or took 5 min). Stop runners
# whose parent Ollama no longer runs — a live Ollama's own runners are left alone.
$liveOllama = @(Get-Process ollama -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -like "*\Ollama\*" -and $liveOllama -notcontains $_.ParentProcessId } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if (-not (Up 11434)) {
    $ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
    if (-not $ollama) { Note "Ollama wurde nicht gefunden. Bitte scripts\install.ps1 ausfuehren."; exit 1 }
    Start-Process -WindowStyle Hidden -FilePath $ollama -ArgumentList "serve"
}

# Where the agent works. The OpenCode server runs here, so files land in this folder.
$work = Join-Path $HOME "code"
New-Item -ItemType Directory -Force -Path $work | Out-Null

# OpenCode engine server (the chat API the UI talks to, port 4096).
# Switches read only at start (measured 2026-10-15 with a prompt capture): without the two skill switches every request
# carries ~43 unrelated skills from ~/.claude/skills and ~/.agents/skills (~8.000 of ~17.600 tokens); with them ~9.500.
$env:OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = "1"
$env:OPENCODE_DISABLE_EXTERNAL_SKILLS = "1"
$env:OPENCODE_DISABLE_AUTOUPDATE = "1"   # stay on OpenCode 1.x (2.x changes the server API this UI uses)
$env:OPENCODE_DISABLE_SHARE = "1"        # never publish a session online
$launchSig = "v2;skills-own-only;autoupdate-off;share-off"   # change when the switches above change
$sigFile = Join-Path $Root "logs\opencode-launch.txt"
$cfgFile = Join-Path $HOME ".config\opencode\opencode.json"
New-Item -ItemType Directory -Force -Path (Join-Path $Root "logs") | Out-Null
$opencode = (Get-Command opencode -ErrorAction SilentlyContinue).Source
if (-not $opencode) { Note "OpenCode wurde nicht gefunden. Bitte scripts\install.ps1 ausfuehren."; exit 1 }

# OpenCode reads its config and these switches only when it starts. If it is older than the config (an update ran) or
# was started with other switches, restart it — unless a task is running. Otherwise an update stays inactive, and a
# broken config stays hidden until the next PC restart.
if (Up 4096) {
    $ocPid = (Get-NetTCPConnection -LocalPort 4096 -State Listen | Select-Object -First 1).OwningProcess
    $proc = Get-Process -Id $ocPid -ErrorAction SilentlyContinue
    $sigOk = (Test-Path $sigFile) -and ((Get-Content $sigFile -Raw).Trim() -eq $launchSig)
    $cfgNewer = $proc -and (Test-Path $cfgFile) -and ((Get-Item $cfgFile).LastWriteTime -gt $proc.StartTime)
    if ($proc -and ($cfgNewer -or -not $sigOk)) {
        $busy = $false
        try {
            $st = Invoke-RestMethod -TimeoutSec 3 "http://127.0.0.1:4096/session/status"
            # Iterate the properties themselves: piping an empty list would pass one $null and count as "busy".
            $busy = @($st.PSObject.Properties | Where-Object { $_.Value.type -ne "idle" }).Count -gt 0
        } catch {}
        if (-not $busy) { Stop-Process -Id $ocPid -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 600 }
    }
}
if (-not (Up 4096)) {
    # Let OpenCode check its own config first: an invalid file would otherwise just leave the app "offline".
    $check = & $opencode models ollama 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        $msg = ($check -replace '\x1b\[[0-9;]*m', '').Trim()
        Note ("Die OpenCode-Einstellungen sind ungueltig, OpenDante kann nicht starten:`n$cfgFile`n`n" +
              $msg.Substring(0, [Math]::Min(500, $msg.Length)) + "`n`nBitte scripts\install.ps1 erneut ausfuehren.")
        exit 1
    }
    Start-Process -WindowStyle Hidden -FilePath $opencode -ArgumentList "serve", "--port", "4096" -WorkingDirectory $work
    Set-Content -Path $sigFile -Value $launchSig -Encoding ascii
}

if ($Terminal) {
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-NoProfile", "-Command", "Set-Location '$work'; & '$opencode'"
    exit 0
}

# Companion: serves the web UI and runs the settings/updates (port 4097).
# It ships WITH the app and changes on every update, so unlike Ollama/OpenCode we ALWAYS restart it here — otherwise
# an updated companion keeps running the old code (e.g. a new endpoint stays missing) until the PC reboots.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Note "Node wurde nicht gefunden. Bitte scripts\install.ps1 ausfuehren (oder starte mit -Terminal)."; exit 1 }
Get-NetTCPConnection -LocalPort 4097 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 300
$env:OPENDANTE_ROOT = $Root
Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList (Join-Path $Root "companion\server.mjs") -WorkingDirectory $Root

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
