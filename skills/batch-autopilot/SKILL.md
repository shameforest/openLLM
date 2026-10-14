---
name: batch-autopilot
description: Für große oder komplexe Aufträge, die in einem Durchgang nicht zuverlässig gelingen. Arbeitet in kleinen Etappen mit einem Gedächtnis-Dokument (FORTSCHRITT.md), damit der Ursprungsauftrag, der Verlauf und der aktuelle Stand nie verloren gehen. Nutzen, sobald eine Aufgabe mehr als ein paar Schritte oder mehrere Dateien umfasst, oder wenn du merkst, dass du abschweifst, den Auftrag vergisst oder dich bei Werkzeugen verhedderst.
---

# Batch-Autopilot: große Aufträge zuverlässig zu Ende bringen

Du bist ein lokales Modell mit begrenztem Gedächtnis. Deine drei bekannten Schwächen und die Gegenmittel:
- **Du überdenkst.** → Denk kurz, handle früh, prüfe am echten Ergebnis.
- **Du verlierst bei langen Aufgaben den Faden und vergisst den Ursprungsauftrag.** → Du arbeitest nie aus dem Gedächtnis. Dein Gedächtnis ist die Datei `FORTSCHRITT.md`; du liest sie zu Beginn jeder Etappe ganz.
- **Deine Werkzeugnutzung driftet nach vielen Schritten.** → Du machst eine Etappe pro Durchgang und beginnst dann bewusst frisch.

## Schritt 0 — einmal, bevor du etwas baust
Lege im Projektordner `FORTSCHRITT.md` an (oder aktualisiere eine vorhandene). Inhalt, genau diese Abschnitte:
- **Ziel:** der Ursprungsauftrag des Nutzers, **wörtlich** kopiert. Ändere ihn nie.
- **Plan:** nummerierte, kleine Schritte (je ein Schritt = in einer Etappe schaffbar und prüfbar).
- **Erledigt:** anfangs leer.
- **Aktueller Schritt:** die Nummer, an der du arbeitest.
- **Nächster Schritt:** was danach kommt.
- **Offene Fragen / Risiken:** was unklar ist.

Zeig dem Nutzer den Plan in einem kurzen Satz und beginne dann mit Schritt 1.

## Jede Etappe — immer dieselbe Schleife
1. **Lies `FORTSCHRITT.md` vollständig.** Nichts aus dem Gedächtnis.
2. **Nimm nur den „Aktuellen Schritt".** Nicht mehr. Lass alle anderen Schritte in Ruhe.
3. **Setze ihn in kleinen Teilen um.** Nach jeder Dateiänderung kurz prüfen, ob sie sinnvoll ist.
4. **Führe es aus.** Starte das Programm oder die Tests und lies die **echte** Ausgabe. Behaupte nie, etwas funktioniere, ohne es ausgeführt zu haben.
5. **Aktualisiere `FORTSCHRITT.md`:** schiebe den Schritt nach „Erledigt", setze „Aktueller Schritt" und „Nächster Schritt" neu, notiere neue offene Fragen.
6. **Committe** mit einer kurzen, klaren Nachricht (`git add` + `git commit`).
7. **Berichte in einem Satz** auf Deutsch: was fertig ist und was als Nächstes kommt.

## Bewusst frisch anfangen
Nach etwa **8 Schritten** oder wenn deine Antworten unübersichtlich werden: beginne eine neue Etappe mit leerem Kopf. `FORTSCHRITT.md` trägt den gesamten Stand — du verlierst nichts. So vermeidest du die Werkzeug-Drift.

## Regeln, die immer gelten
- **Der Ursprungsauftrag in „Ziel" ist unantastbar.** Bei jedem Zweifel, ob du noch auf Kurs bist, vergleiche mit „Ziel".
- **Kleine, prüfbare Schritte.** Lieber zehn kleine, geprüfte Schritte als einer, der vieles auf einmal ändert und nicht läuft.
- **Niemals Tests löschen oder überspringen, um „grün" zu wirken.** Scheitert ein Test, behebe die Ursache.
- **Dreimal gescheitert → stopp.** Wenn derselbe Schritt dreimal fehlschlägt, halte an, schreib in „Offene Fragen", was klemmt, und frag den Nutzer mit einer klaren Frage.
- **Gefährliche Befehle** (Löschen, Platte formatieren, `git push --force`, `reset --hard`) nie ohne Rückfrage.

## Fertig
Wenn jeder Schritt in „Erledigt" steht und das Endergebnis die Tests besteht: führe die Tests ein letztes Mal gesamt aus, fasse das Ergebnis in zwei, drei Sätzen zusammen und nenne, was der Nutzer selbst prüfen sollte.
