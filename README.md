# OpenDante

Ein kostenloser, lokaler KI-Programmierassistent wie Claude Code — läuft mit offenen Modellen auf dem eigenen PC, ohne Abo und ohne fremde Programmierschnittstelle (*API*).

**Stand (2026-10-15):** läuft auf dem Shadow-PC. Eigene Oberfläche im Chrome-Fenster über OpenCode (die Agenten-Hülle) und Ollama (der Modell-Server) mit dem unzensierten Qwen3.8 27B. Dazu: Verlauf, Gedankengang-Seitenleiste, Countdown, Plan-Modus, Aufgabenliste, Rückgängig mit Vorher/Nachher-Ansicht, Dateien anhängen, Gedächtnis-Anzeige und optional Claude als Helfer mit Tageslimit.

- **Starten:** Desktop-Symbol „OpenDante“ (`scripts/start.ps1`).
- **Aktualisieren:** `powershell -ExecutionPolicy Bypass -File C:\openLLM\scripts\install.ps1 -SkipModel`
- **Messen, ob eine Änderung hilft:** `node scripts/eval.mjs` löst feste Aufgaben (7 leichte, 6 schwere) und prüft sie automatisch ([eval/tasks](eval/tasks/README.md)); Vergleiche mit `--level schwer --repeat 2`.
- **Oberfläche automatisch prüfen:** `npm run e2e` in `web/` klickt die wichtigsten Abläufe in Chrome durch, gegen einen nachgeahmten Server (ohne Grafikkarte).
- [Plan und Architektur](docs/PLAN.md) · [Recherche](docs/RESEARCH.md) · [Fortschritt](PROGRESS.md)
- Schwesterprojekt: **OpenDali** (lokaler Bildgenerator, `C:\Studio`). Beide teilen sich die Grafikkarte; OpenDali entlädt das Sprachmodell beim Start.

> Ehrliche Erwartung: Auf einer 24-GB-Grafikkarte ist dies ein brauchbarer Assistent für klar umrissene Aufgaben, bleibt aber bei langen, selbstständigen Läufen unter dem Niveau von Claude Code (Konfidenz 75).
