import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, os.getcwd())


def fail(msg):
    s = " ".join(str(msg).split())[:200].encode("ascii", "backslashreplace").decode("ascii")
    print("FAIL: " + s)
    sys.exit(1)


def eq(got, erwartet, was):
    if got != erwartet:
        fail(f"{was} = {got!r}, erwartet {erwartet!r}")


def main():
    cwd = os.getcwd()
    if not os.path.isfile(os.path.join(cwd, "todo.py")):
        fail("todo.py fehlt")
    from todo import TodoListe

    t = TodoListe()
    eq(t.offen(), [], "neue Liste offen()")
    eq(t.erledigt(), [], "neue Liste erledigt()")

    texte = ["Käse für Mütter besorgen", "Straße fegen", "Öl wechseln – 100 %", "Ärzte anrufen"]
    ids = [t.hinzufuegen(x) for x in texte]
    eq(ids, [1, 2, 3, 4], "IDs der ersten vier Eintraege")
    if not all(type(i) is int for i in ids):
        fail("hinzufuegen gibt kein int zurueck")
    eq(t.offen(), texte, "offen() nach Hinzufuegen")
    eq(t.erledigt(), [], "erledigt() nach Hinzufuegen")

    t.erledigen(3)
    t.erledigen(1)
    eq(t.offen(), [texte[1], texte[3]], "offen() nach erledigen")
    eq(t.erledigt(), [texte[0], texte[2]], "erledigt() Reihenfolge (Hinzufuegen-Reihenfolge)")
    t.erledigen(3)  # nochmal erledigen: kein Fehler, keine Aenderung
    eq(t.erledigt(), [texte[0], texte[2]], "erledigt() nach doppeltem erledigen")
    eq(t.offen(), [texte[1], texte[3]], "offen() nach doppeltem erledigen")

    for schlecht in (99, 0, -1, 5):
        try:
            t.erledigen(schlecht)
        except KeyError:
            continue
        except Exception as e:
            fail(f"erledigen({schlecht}) wirft {type(e).__name__} statt KeyError")
        fail(f"erledigen({schlecht}) wirft kein KeyError")

    # Listen sind unabhaengig voneinander
    andere = TodoListe()
    eq(andere.offen(), [], "zweite Liste teilt Zustand")
    eq(andere.hinzufuegen("x"), 1, "zweite Liste erste ID")

    with tempfile.TemporaryDirectory() as tmp:
        # str-Pfad
        pfad = os.path.join(tmp, "liste.json")
        t.speichern(pfad)
        roh = Path(pfad).read_bytes()
        if roh.startswith(b"\xef\xbb\xbf"):
            fail("JSON-Datei hat ein BOM")
        try:
            daten = json.loads(roh.decode("utf-8"))
        except Exception as e:
            fail(f"Datei ist kein gueltiges UTF-8-JSON: {type(e).__name__}")
        if not isinstance(daten, (dict, list)):
            fail("JSON-Datei hat keinen Container als Wurzel")

        t2 = TodoListe.laden(pfad)
        if not isinstance(t2, TodoListe):
            fail("laden() gibt keine TodoListe zurueck")
        eq(t2.offen(), [texte[1], texte[3]], "offen() nach Laden")
        eq(t2.erledigt(), [texte[0], texte[2]], "erledigt() nach Laden")
        eq(t2.hinzufuegen("Nach dem Laden"), 5, "naechste ID nach Laden")
        eq(t2.offen(), [texte[1], texte[3], "Nach dem Laden"], "offen() nach Laden + hinzufuegen")
        t2.erledigen(2)
        eq(t2.erledigt(), [texte[0], texte[1], texte[2]], "erledigt() nach Laden + erledigen(2)")
        # Original bleibt unveraendert
        eq(t.offen(), [texte[1], texte[3]], "Original nach Laden veraendert")

        # Path-Objekt, zweiter Round-Trip
        pfad2 = Path(tmp) / "zweite.json"
        t2.speichern(pfad2)
        t3 = TodoListe.laden(pfad2)
        eq(t3.offen(), t2.offen(), "offen() nach zweitem Round-Trip")
        eq(t3.erledigt(), t2.erledigt(), "erledigt() nach zweitem Round-Trip")
        eq(t3.hinzufuegen("noch einer"), 6, "naechste ID nach zweitem Round-Trip")
        try:
            t3.erledigen(7)
        except KeyError:
            pass
        else:
            fail("erledigen(7) nach Laden wirft kein KeyError")

        # Leere Liste
        pfad3 = os.path.join(tmp, "leer.json")
        TodoListe().speichern(pfad3)
        t4 = TodoListe.laden(pfad3)
        eq(t4.offen(), [], "leere Liste offen()")
        eq(t4.erledigt(), [], "leere Liste erledigt()")
        eq(t4.hinzufuegen("erster"), 1, "ID in geladener leerer Liste")

        # Alle erledigt: naechste ID bleibt erhalten
        pfad4 = os.path.join(tmp, "alle.json")
        t5 = TodoListe()
        t5.hinzufuegen("a")
        t5.hinzufuegen("b")
        t5.erledigen(1)
        t5.erledigen(2)
        t5.speichern(pfad4)
        t6 = TodoListe.laden(pfad4)
        eq(t6.offen(), [], "alle erledigt: offen()")
        eq(t6.erledigt(), ["a", "b"], "alle erledigt: erledigt()")
        eq(t6.hinzufuegen("c"), 3, "ID nach Laden einer komplett erledigten Liste")

    # test_todo.py
    test_pfad = os.path.join(cwd, "test_todo.py")
    if not os.path.isfile(test_pfad):
        fail("test_todo.py fehlt")
    with open(test_pfad, encoding="utf-8") as f:
        quelle = f.read()
    anzahl_assert = len(re.findall(r"(?m)^\s*assert\b", quelle))
    if anzahl_assert < 5:
        fail(f"test_todo.py hat nur {anzahl_assert} assert (mind. 5)")
    anzahl_tests = len(re.findall(r"(?m)^\s*def test_\w*\(", quelle))
    if anzahl_tests < 5:
        fail(f"test_todo.py hat nur {anzahl_tests} Testfunktionen (mind. 5)")

    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    try:
        r = subprocess.run(
            [sys.executable, "-B", test_pfad],
            cwd=cwd,
            capture_output=True,
            timeout=8,
            env=env,
        )
    except subprocess.TimeoutExpired:
        fail("python test_todo.py dauert zu lange")
    if r.returncode != 0:
        err = r.stderr.decode("utf-8", "replace").strip().splitlines()
        fail(f"python test_todo.py Exit-Code {r.returncode} {err[-1] if err else ''}")
    print("OK")


try:
    main()
except SystemExit:
    raise
except Exception as e:
    fail(f"{type(e).__name__}: {e}")
