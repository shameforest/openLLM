# Eval-Aufgaben

Dieser Ordner enthält eine kleine, feste Aufgabenmenge, mit der ein lokaler Coding-Agent (OpenCode mit einem 27B-Modell unter Windows) vergleichbar gemessen wird. Jede Aufgabe ist ein eigener Unterordner. Alles läuft offline, nur mit `python` (3.12) und `node` (24), ohne pytest und ohne npm-Pakete.

## Aufbau einer Aufgabe

```
tasks\<id>\
  task.json     Beschreibung der Aufgabe
  start\        Dateien, mit denen der Agent startet (wird in einen frischen Arbeitsordner kopiert)
  check.py      oder check.mjs: der automatische Prüfer (liegt NEBEN task.json)
```

## Felder in task.json

| Feld         | Bedeutung |
|--------------|-----------|
| `id`         | Kurzname, identisch mit dem Ordnernamen |
| `title`      | Kurzer deutscher Titel |
| `prompt`     | Die deutsche Anweisung, die der Agent bekommt (nennt Dateinamen, Funktionen, Signaturen und Ausgabeformat genau) |
| `check`      | Prüfbefehl als Liste, z. B. `["python", "check.py"]` oder `["node", "check.mjs"]` |
| `timeoutMin` | Zeitlimit für den Agenten in Minuten |
| `kind`       | Art der Aufgabe: `fix`, `new`, `refactor`, `cli`, `read`, `multi`, `js`, `data`, `feature` oder `long` |
| `level`      | `schwer` für die großen Aufgaben (mehrere Dateien, 20–60 Schritte); fehlt das Feld, gilt `leicht`. Auswahl im Runner mit `--level leicht` oder `--level schwer` |

## Wie der Prüfer läuft

Der Runner kopiert `start\` in einen frischen Arbeitsordner, lässt den Agenten dort arbeiten und startet danach den Prüfer mit dem Arbeitsordner als aktuellem Verzeichnis. Die Prüfdatei wird mit absolutem Pfad aufgerufen, zum Beispiel:

```
python C:\openLLM\eval\tasks\roemisch\check.py
```

Der Prüfer liest die Dateien des Agenten aus dem aktuellen Verzeichnis, endet mit Exit-Code 0 bei Erfolg und sonst mit einem Wert ungleich 0 und gibt dann genau eine kurze Zeile `FAIL: ...` aus. Er ist deterministisch, braucht unter 10 Sekunden (die schweren unter 15) und hinterlässt im Arbeitsordner nichts (Temp-Dateien werden gelöscht, es entstehen keine `__pycache__`-Ordner).

## Wichtige Regel

**Prüfdateien (`check.py`, `check.mjs`) gehören nie nach `start\`.** Der Agent darf sie nie sehen, sonst kann er auf den Prüfer hin arbeiten statt auf die Aufgabe. Dasselbe gilt für Musterlösungen: Sie werden nirgends in diesem Ordner abgelegt.

Wo Prüfer erkennen, dass der Agent eine sichtbare Datei nicht verändert hat (z. B. `test_statistik.py`, `test.mjs` oder die Quelldateien bei `code-lesen`), vergleichen sie den SHA-256-Hash (Zeilenenden auf LF normalisiert) mit einem fest eingetragenen Wert. Wer eine dieser Startdateien ändert, muss den Hash im Prüfer neu eintragen.

## Aufgaben

| id              | kind     | Minuten | Kurzbeschreibung |
|-----------------|----------|---------|------------------|
| `fix-offbyone`  | fix      | 8       | Median-Fehler bei gerader Länge beheben, Test nicht ändern |
| `roemisch`      | new      | 8       | `roemisch.py` neu schreiben (Zahl zu römisch und zurück) |
| `umbenennen`    | refactor | 10      | Funktion in drei Dateien umbenennen, alter Name darf nirgends bleiben |
| `wortzaehler`   | cli      | 8       | Kommandozeilenprogramm: die 3 häufigsten Wörter einer Datei |
| `code-lesen`    | read     | 6       | Im Code die Funktion finden, die `speichere()` aufruft; nur `antwort.txt` schreiben |
| `todo-modul`    | multi    | 20      | `todo.py` mit Speichern/Laden plus eigene Tests `test_todo.py` |
| `js-export`     | js       | 8       | `summe.mjs` reparieren, bis `node test.mjs` besteht |

Schwer (`"level": "schwer"`):

| id              | kind     | Minuten | Kurzbeschreibung |
|-----------------|----------|---------|------------------|
| `bugjagd`       | fix      | 25      | Shop-App in 5 Dateien: drei versteckte Fehler (Rundung, doppelter Rabatt, Überverkauf), Tests nicht ändern |
| `feature-csv`   | feature  | 25      | Bestehendes CLI-Werkzeug um `--gruppe kategorie` und `--format json` erweitern, Standardausgabe bleibt gleich |
| `klassen-umbau` | refactor | 25      | Modul mit globalem Zustand in eine Klasse `Bank` umbauen, alte Funktionen als dünne Hülle behalten |
| `cli-aufgaben`  | long     | 30      | Aufgabenverwaltung als CLI mit 5 Unterbefehlen, JSON-Speicher, exakten Ausgaben und eigenen Tests |
| `js-rechner`    | js       | 25      | Rechenausdrücke in 3 Modulen: Vorrangfehler beheben, `^`, Minus-Vorzeichen und Syntaxfehler ergänzen |
| `log-analyse`   | data     | 20      | Zugriffsprotokoll auswerten, `bericht.json` mit genauem Aufbau; Prüfer testet auch ein verstecktes Protokoll |
