# Installation auf dem Shadow-PC (openLLM)

Stand 14.10.2026. Alles läuft kostenlos auf deinem eigenen PC. Keine Abos, keine fremde Programmierschnittstelle.

> **Noch nicht auf Windows getestet.** Dieser Installer ist der erste Entwurf. Ich habe ihn in der Cloud geschrieben, wo es kein Windows und keine Grafikkarte gibt. Den echten Lauf machen wir zusammen auf dem Shadow-PC und beheben, was hakt — genau wie beim Start von OpenDali.

## So arbeiten wir zusammen
Claude baut und testet in der Cloud-Sitzung und legt alles auf GitHub. Auf dem Shadow-PC führst du einen Befehl aus. Der installiert alles. Klappt etwas nicht, schickst du Claude einen Screenshot oder die Protokolldatei.

## Voraussetzung
- Windows 11 mit der NVIDIA Quadro RTX 6000 (24 GB). Git für Windows ist schon installiert (aus dem OpenDali-Projekt).
- **Wichtig:** Der Programmier-Assistent und OpenDali teilen sich die Grafikkarte und laufen **nicht gleichzeitig**. Beende OpenDali, bevor du openLLM nutzt (der Starter fragt dich automatisch).

## Installieren und aktualisieren (immer derselbe Befehl)
1. Windows-Taste, **PowerShell** eintippen, Enter.
2. Das Projekt holen und installieren:
   ```powershell
   git clone https://github.com/shameforest/openllm C:\openLLM
   cd C:\openLLM; powershell -ExecutionPolicy Bypass -File scripts\install.ps1
   ```
   Später genügt zum Aktualisieren:
   ```powershell
   cd C:\openLLM; git pull; powershell -ExecutionPolicy Bypass -File scripts\install.ps1
   ```
3. Warten. Beim ersten Mal lädt das Skript die Programme und das Modell (ca. 18 GB). Bricht es ab, denselben Befehl noch einmal starten — fertige Schritte werden übersprungen, Downloads laufen weiter.
4. Am Ende liegt das Symbol **openLLM** auf dem Desktop.

Nur die Programme, ohne das Modell:
```powershell
cd C:\openLLM; powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -SkipModel
```

## Was das Skript installiert
| Was | Wozu |
|---|---|
| Scoop | Paketverwaltung ohne Administratorrechte |
| OpenCode | die Agenten-Hülle: nimmt Anweisungen, bearbeitet Dateien, führt Terminal/Git/Tests aus |
| Ollama | der Modell-Server: lässt das Modell auf der Grafikkarte laufen |
| Qwen3.8-27B | das erste Programmier-Modell (Apache-2.0, ca. 18 GB) |
| opencode.json | verbindet OpenCode mit dem lokalen Modell |
| Desktop-Symbol „openLLM“ | Start mit Doppelklick |

## Benutzen
- Doppelklick auf **openLLM**. Es öffnet sich ein Terminal-Fenster mit dem Assistenten in deinem Ordner `C:\Users\…\code`.
- Tipp deine Anweisung in normaler Sprache ein, z. B. „Baue mir eine kleine Webseite mit einem Kontaktformular“. Der Assistent plant, schreibt Dateien und führt Befehle aus.
- Eine Web-Oberfläche (im Browser) kommt in einem späteren Schritt (M5).

## Wenn etwas schiefgeht
Jeder Lauf schreibt ein Protokoll nach `C:\openLLM\logs\install-<Datum>.log`. Schick Claude die Datei oder einen Screenshot der roten Meldung.

## Ehrliche Erwartung
Auf 24 GB wird dies ein brauchbarer Assistent für klar umrissene Aufgaben, bleibt aber bei langen, selbstständigen Läufen unter dem Niveau von Claude Code (Konfidenz 75). Das Modell überdenkt Aufgaben manchmal stark; wir stellen die „Denkstufe“ passend ein.
