---
projekt: OpenDante
art: Lokaler KI-Programmierassistent · OpenCode + Ollama + Web
farbe: #9B7BFF
reihenfolge: 3
meilenstein: M3 · Autonomie und Sicherheit
fortschritt: 65
fortschritt_text: Meilensteine M1–M5 (2 fertig, M3 + M4 weit)
---
## Stand
Verbesserer-Lauf 3 ist umgesetzt und gemessen. Ohne Nachdenken löst OpenDante die schweren Testaufgaben in 12 von 12 Fällen, 2,3-mal schneller als mit; das ist jetzt Standard. Neu: Dateien anhängen, schnellere Sicherung, weniger Rückfragen, automatischer Klicktest.
## Gerade
- [ ] (du) OpenDante im Alltag ausprobieren: große Aufträge, Dateien anhängen
## Als Nächstes
- [ ] Wichtigste Befunde der Gesamtanalyse beheben: Absturz des Begleitdienstes (AN-01), Umlaute im Installer (AN-03), Lücken beim automatischen Erlauben (AN-04), hängende Anzeige „läuft“ (AN-05)
- [ ] M3: Browser-Tests über Playwright-MCP für den Agenten einschalten
- [ ] M3: Abschottung (Sandbox) prüfen
- [ ] Neuer Verbesserer-Lauf nach einer Woche Alltag
## Lernen
- [ ] Was Git-Schnappschüsse sind und warum „Rückgängig“ sie braucht
## Erledigt
- [x] 2026-10-16: Gesamtanalyse aller Funktionen → Karte docs/ARCHITEKTUR.md mit 24 Befunden; Startfehler nach „OpenDali beenden? Ja“ behoben
- [x] 2026-10-16: Modell-Vorladen mit Ladebalken am Shadow-PC bewiesen (38 s, danach sofort bereit); verwaiste Ollama-Prozesse räumt der Start jetzt weg
- [x] 2026-10-15: „Schnell“ als Standard: umsetzen ohne Nachdenken (12/12, 2,3× schneller)
- [x] 2026-10-15: Antwortgrenze 16k – große Dateien werden nicht mehr abgeschnitten
- [x] 2026-10-15: Modellvergleich: Uncensored 12/12, Original 9/12
- [x] 2026-10-15: Dateien anhängen
- [x] 2026-10-15: Sicherung mit .gitignore (86 s → 5 s Vorlauf)
- [x] 2026-10-15: Harmlose Einzeiler laufen ohne Rückfrage
- [x] 2026-10-15: 6 schwere Testaufgaben + automatischer Klicktest
- [x] 2026-10-15: Testlauf mit 7 festen Aufgaben (7 von 7 gelöst)
- [x] 2026-10-15: Rückgängig + Vorher/Nachher-Ansicht
- [x] 2026-10-15: Plan-Modus „Erst planen, dann umsetzen“
- [x] 2026-10-15: Aufgabenliste + Gedächtnis-Anzeige
- [x] 2026-10-15: Claude: Sonnet als Standard + Tageslimit
- [x] 2026-10-15: Konfiguration repariert, Prompt 46 % kürzer
- [x] 2026-10-15: Chats umbenennen + löschen, Ordner-Browser
- [x] 2026-10-15: Feststecken behoben: Freigabe-Karte + Auto-Erlauben
- [x] 2026-10-15: Fortschritt Schritt für Schritt + echter Countdown
- [x] 2026-10-15: Verlauf: Chats speichern und fortsetzen
- [x] 2026-10-15: Zensurfreies Modell als Standard + Modellwahl
- [x] 2026-10-14: Claude-Auslagerung und -Prüfung automatisch
- [x] 2026-10-14: GitHub-Projekte klonen, committen, pushen
- [x] 2026-10-14: Skills hochladen und per /name aufrufen
- [x] 2026-10-14: M1 + M2 auf dem Shadow-PC bewiesen
