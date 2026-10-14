# Plan: openLLM (lokaler KI-Programmierassistent wie Claude Code)

## Ziel
Ein Werkzeug, das selbstständig programmiert — Dateien lesen und schreiben, Befehle im Terminal ausführen, testen, Fehler beheben, mit Git arbeiten — gesteuert von einem *offenen Sprachmodell* (ein KI-Modell, dessen Dateien man frei herunterladen und selbst laufen lassen kann) auf deinem eigenen PC. Kein Abo, keine fremde Programmierschnittstelle, keine Zensur von normalen Programmieraufgaben.

Wir trainieren **kein** eigenes Modell (das bräuchte Tausende Grafikkarten). Wir **bauen zusammen und richten ein**: eine bestehende, bewährte *Agenten-Hülle* (das Programm, das dem Modell Werkzeuge gibt) erweitern, ein Modell über einen *Modell-Server* betreiben und die fehlenden Teile ergänzen.

## Architektur

```
 Desktop-Symbol "openLLM"
        │ startet alles im Hintergrund
        ▼
 Terminal-Fenster  ──┐
 Chrome-Fenster     ─┤── OpenCode (die Agenten-Hülle: plant, bearbeitet Dateien,
 (Web-Oberfläche)    │    führt Terminal/Git/Tests aus, verwaltet Rechte)
                     │        │
                     │        ├──► Ollama (Modell-Server) ──► lokales Modell auf der Grafikkarte
                     │        ├──► Werkzeuge über MCP (Browser-Test, Websuche, Datenbank, GitHub)
                     │        └──► dein Projekt-Ordner (Code, Git)
```

**Einfach erklärt:**
- **OpenCode:** das Herzstück. Es nimmt deine Anweisung in normaler Sprache, zerlegt sie in Schritte, ändert Dateien, führt Befehle aus und prüft das Ergebnis. Es gibt zwei Oberflächen auf demselben Motor: ein Terminal-Programm und eine Web-Oberfläche.
- **Ollama:** lässt das Sprachmodell auf deiner Grafikkarte laufen und liefert seine Antworten.
- **MCP** (*Model Context Protocol*, ein Standard-Stecksystem für KI-Werkzeuge): damit docken wir Browser-Test, Websuche und mehr an.

## Technik-Entscheidungen

**Agenten-Hülle: OpenCode erweitern (nicht selbst bauen)**
- Bringt fast alles aus dem Auftrag schon mit: Plan-Modus, Unteragenten, Modell-Rollen, MCP, Skills, Hooks, Rechte-Stufen, Terminal-Betrieb und eine Web-Oberfläche. Lizenz MIT (kommerziell frei). Liest dieselben Dateien wie Claude Code (`CLAUDE.md`, `.claude/skills`).
- **Konfidenz 70.** Das kippt, wenn ein eigener Test auf deinem Modell zeigt, dass eine andere Hülle (z. B. Qwen Code mit eingebauter Abschottung) spürbar besser mit dem lokalen Modell zusammenspielt. Dann wechseln wir — die restliche Architektur bleibt.

**Modell-Server: Ollama**
- Läuft auf deiner Turing-Karte, kennst du aus OpenDali, wechselt Modelle automatisch, hat die gleiche Rechen-Grundlage wie llama.cpp.
- **Konfidenz 70.** Das kippt bei Werkzeug-Fehlern oder wenn wir mehr als zwei Agenten gleichzeitig brauchen; dann direkt `llama-server` (eine Zeile in der Konfiguration).

**Modell: zuerst eines, Apache-2.0, das in 24 GB passt**
- Start mit dem stärksten passenden Modell. Die genaue Wahl und Lizenz prüfen wir am Download-Tag (siehe `RESEARCH.md`).
- **Konfidenz 60**, weil die Modellnamen aus Suchzusammenfassungen stammen, nicht aus geprüften Quellen.

**Start: Desktop-Symbol mit einem PowerShell-Starter** (wie bei OpenDali), der Ollama und OpenCode versteckt startet und das Fenster öffnet.

## Meilensteine

| # | Meilenstein | Inhalt | Beweis |
|---|---|---|---|
| M0 | Recherche und Plan ✓ | Hardware, Modelle, Hülle, Server, Entscheidungen | dieses Dokument und `RESEARCH.md` |
| M1 | Fundament | Installer (Ollama + 1 Modell + OpenCode), Starter mit Symbol, alles läuft zusammen, erster selbstständiger Mini-Auftrag | Screenshot + Protokoll vom Shadow-PC |
| M2 | Projekt-Bedienung | `CLAUDE.md`/Skills/Slash-Befehle fürs Projekt, Plan-Modus, sichtbare Aufgabenliste, Rechte-Stufen, Rückgängig-Punkte (über Git) | Klick-/Terminal-Test mit Nachweis |
| M3 | Autonomie und Sicherheit | Abschottung (WSL/Docker), Websuche (SearXNG), Browser-Test (Playwright über MCP), Bilder als Eingabe | Testlauf, der eine kleine Web-App baut und prüft |
| M4 | Power | Unteragenten, Modell-Rollen (weitere Modelle + Blindtest), MCP-Werkzeuge, Hooks, Betrieb ohne Fenster, Nutzungs-Übersicht | Parallel-Test mit zwei Agenten |
| M5 | Oberfläche und Feinschliff | Web-Oberfläche aufräumen, Desktop-App-Modus wie OpenDali, Design nach deinen Referenzen | Vorher/Nachher-Screenshots |

*Vieles davon bringt OpenCode schon mit — unsere Arbeit ist Einrichten, Verbinden und Feinschliff, nicht Nachbauen. Das spart Zeit und hält die Qualität hoch.*

## Arbeitsweise (wie bei OpenDali)
1. Gebaut und getestet wird in den Cloud-Sitzungen (dafür hast du Guthaben). Der Shadow-PC bekommt Updates über einen Installer-Befehl. Echte Modell-Läufe, Geschwindigkeit und den Blindtest prüfst du dort und schickst Screenshots oder Protokolle.
2. Schritt für Schritt: jede Funktion einzeln bauen, testen, zeigen; während du prüfst, baue ich die nächste.
3. Hier in der Cloud gibt es **keine Grafikkarte und kein Windows**. Prüfbar sind Konfiguration, Skript-Aufbau und Logik — nicht der echte Modell-Lauf. Das sage ich jedes Mal klar.
4. Kosten sparen ohne Qualitätsverlust (Skill `savetokens`): Architektur, schwierige Fehler und Endprüfung mache ich selbst; klar umrissene Teile gehen an günstigere Modelle, immer mit Prüfung.

## Risiken und Kippbedingungen
- **Modellqualität auf 24 GB:** bleibt voraussichtlich unter Claude Code bei langen Läufen (Konfidenz 75). Lösung wäre mehr Grafikspeicher (gemieteter Server) — von dir bewusst ausgeschlossen. Wir holen das Beste aus dem Lokalen heraus.
- **Grafikspeicher geteilt mit OpenDali:** Bild-App und Programmier-Modell laufen nicht gleichzeitig; der Starter entlädt das eine vor dem anderen.
- **Turing-Eigenheiten:** erste Anfrage nach dem Start kann langsam sein (die Rechenkerne werden einmalig übersetzt); in der Konfiguration abgefangen.
- **Abschottung auf dem Shadow-PC:** ob die virtualisierte Maschine WSL/Docker erlaubt, ist ungeprüft. Falls nicht, nehmen wir eine leichtere Abschottung über Windows-Bordmittel.
- **Unverifizierte Rechercheteile:** Modellnamen und Zahlen am Download-Tag gegen die echte Quelle prüfen (siehe `RESEARCH.md`).
