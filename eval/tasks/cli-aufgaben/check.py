import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

sys.dont_write_bytecode = True


class CheckFehler(Exception):
    pass


def fail(msg):
    # wirft statt sys.exit, damit es auch in Hilfs-Threads funktioniert
    raise CheckFehler(msg)


class Prog:
    def __init__(self, skript):
        self.skript = skript
        self.env = dict(os.environ)
        self.env["PYTHONIOENCODING"] = "utf-8"
        self.env["PYTHONDONTWRITEBYTECODE"] = "1"

    def run(self, cwd, args):
        try:
            r = subprocess.run(
                [sys.executable, "-B", self.skript] + list(args),
                cwd=cwd, capture_output=True, timeout=15, env=self.env,
            )
        except subprocess.TimeoutExpired:
            fail("aufgaben.py " + " ".join(args) + " dauert zu lange")
        out = r.stdout.decode("utf-8", "replace").replace("\r\n", "\n")
        err = r.stderr.decode("utf-8", "replace").replace("\r\n", "\n")
        return r.returncode, out, err


def ok(prog, cwd, datei, args, erwartet_out):
    """Erwartet Exit-Code 0, genau diese stdout-Ausgabe und leere stderr."""
    rc, out, err = prog.run(cwd, ["--datei", datei] + list(args))
    was = "aufgaben.py " + " ".join(args)
    if rc != 0:
        fail(f"{was}: Exit-Code {rc} {err.strip()[:60]}")
    if out != erwartet_out:
        fail(f"{was}: Ausgabe {out!r}, erwartet {erwartet_out!r}")
    if err.strip():
        fail(f"{was}: unerwartete Ausgabe auf stderr: {err.strip()[:60]!r}")


def fehler(prog, cwd, datei, args, meldung, rc_soll=1):
    """Erwartet Exit-Code rc_soll, leere stdout und genau diese Meldung auf stderr."""
    rc, out, err = prog.run(cwd, ["--datei", datei] + list(args))
    was = "aufgaben.py " + " ".join(args)
    if rc != rc_soll:
        fail(f"{was}: Exit-Code {rc}, erwartet {rc_soll}")
    if out.strip():
        fail(f"{was}: stdout nicht leer bei Fehler: {out.strip()[:60]!r}")
    if meldung is not None and err.strip() != meldung:
        fail(f"{was}: stderr {err.strip()[:70]!r}, erwartet {meldung!r}")


def lese_datei(pfad, was):
    try:
        with open(pfad, "rb") as f:
            roh = f.read()
    except OSError:
        fail(f"{was}: Datei {os.path.basename(pfad)} fehlt")
    if roh.startswith(b"\xef\xbb\xbf"):
        fail(f"{was}: JSON-Datei hat ein BOM")
    try:
        return json.loads(roh.decode("utf-8"))
    except ValueError:
        fail(f"{was}: Datei ist kein gueltiges UTF-8-JSON")


def schreibe_datei(pfad, daten):
    with open(pfad, "wb") as f:
        f.write(json.dumps(daten, ensure_ascii=False, indent=1).encode("utf-8"))


def aufg(i, text, prio, erledigt):
    return {"id": i, "text": text, "prio": prio, "erledigt": erledigt}


def neuer_ordner(tmp, name):
    pfad = os.path.join(tmp, name)
    os.mkdir(pfad)
    return pfad


# ---------------------------------------------------------------------------
def szenario_a(prog, tmp):
    """Ablauf mit Umlauten, Prioritaeten, Sortierung, ID-Vergabe, Dateiinhalt."""
    arbeit = neuer_ordner(tmp, "arbeit_a")
    a = os.path.join(tmp, "a.json")
    ok(prog, arbeit, a, ["neu", "Käse für Mütter besorgen"], "Aufgabe 1 angelegt.\n")
    ok(prog, arbeit, a, ["neu", "Steuererklärung abgeben", "--prio", "hoch"], "Aufgabe 2 angelegt.\n")
    ok(prog, arbeit, a, ["neu", "Fenster putzen", "--prio", "niedrig"], "Aufgabe 3 angelegt.\n")
    ok(prog, arbeit, a, ["neu", "  Rand  ", "--prio", "normal"], "Aufgabe 4 angelegt.\n")
    ok(prog, arbeit, a, ["liste"],
       "  2. [ ] (!) Steuererklärung abgeben\n"
       "  1. [ ] ( ) Käse für Mütter besorgen\n"
       "  4. [ ] ( ) Rand\n"
       "  3. [ ] (-) Fenster putzen\n")
    ok(prog, arbeit, a, ["erledigt", "1"], "Aufgabe 1 erledigt.\n")
    ok(prog, arbeit, a, ["erledigt", "1"], "Aufgabe 1 war schon erledigt.\n")
    ok(prog, arbeit, a, ["liste"],
       "  2. [ ] (!) Steuererklärung abgeben\n"
       "  4. [ ] ( ) Rand\n"
       "  3. [ ] (-) Fenster putzen\n")
    ok(prog, arbeit, a, ["erledigt", "3"], "Aufgabe 3 erledigt.\n")
    ok(prog, arbeit, a, ["liste", "--alle"],
       "  2. [ ] (!) Steuererklärung abgeben\n"
       "  4. [ ] ( ) Rand\n"
       "  1. [x] ( ) Käse für Mütter besorgen\n"
       "  3. [x] (-) Fenster putzen\n")
    ok(prog, arbeit, a, ["statistik"],
       "Gesamt: 4, offen: 2, erledigt: 2 (50 %)\n"
       "Offen nach Priorität: hoch 1, normal 1, niedrig 0\n")
    ok(prog, arbeit, a, ["loeschen", "4"], "Aufgabe 4 gelöscht.\n")
    ok(prog, arbeit, a, ["neu", "Neu nach Löschen", "--prio", "hoch"], "Aufgabe 5 angelegt.\n")
    fehler(prog, arbeit, a, ["loeschen", "4"], "Fehler: Aufgabe 4 nicht gefunden.")
    fehler(prog, arbeit, a, ["erledigt", "99"], "Fehler: Aufgabe 99 nicht gefunden.")
    ok(prog, arbeit, a, ["liste", "--alle"],
       "  2. [ ] (!) Steuererklärung abgeben\n"
       "  5. [ ] (!) Neu nach Löschen\n"
       "  1. [x] ( ) Käse für Mütter besorgen\n"
       "  3. [x] (-) Fenster putzen\n")
    ok(prog, arbeit, a, ["statistik"],
       "Gesamt: 4, offen: 2, erledigt: 2 (50 %)\n"
       "Offen nach Priorität: hoch 2, normal 0, niedrig 0\n")
    daten = lese_datei(a, "Szenario A")
    soll = {
        "naechste_id": 6,
        "aufgaben": [
            aufg(1, "Käse für Mütter besorgen", "normal", True),
            aufg(2, "Steuererklärung abgeben", "hoch", False),
            aufg(3, "Fenster putzen", "niedrig", True),
            aufg(5, "Neu nach Löschen", "hoch", False),
        ],
    }
    if daten != soll:
        fail(f"Dateiinhalt nach Szenario A: {json.dumps(daten, ensure_ascii=True)[:120]}")
    if os.listdir(arbeit):
        fail("Arbeitsordner enthaelt trotz --datei neue Dateien: " + ",".join(os.listdir(arbeit)))


def szenario_standarddatei(prog, tmp):
    """Standarddatei aufgaben.json im Arbeitsordner; leere Liste ohne Datei."""
    arbeit = neuer_ordner(tmp, "arbeit_b")
    rc, out, err = prog.run(arbeit, ["neu", "Standarddatei"])
    if rc != 0 or out != "Aufgabe 1 angelegt.\n":
        fail(f"ohne --datei: Exit-Code {rc}, Ausgabe {out!r} {err.strip()[:60]}")
    daten = lese_datei(os.path.join(arbeit, "aufgaben.json"), "Standarddatei")
    if daten != {"naechste_id": 2, "aufgaben": [aufg(1, "Standarddatei", "normal", False)]}:
        fail("Standarddatei aufgaben.json hat falschen Inhalt")
    rc, out, err = prog.run(arbeit, ["liste"])
    if rc != 0 or out != "  1. [ ] ( ) Standarddatei\n":
        fail(f"liste ohne --datei: Ausgabe {out!r}")

    c = os.path.join(tmp, "c.json")
    ok(prog, arbeit, c, ["liste"], "Keine Aufgaben.\n")
    ok(prog, arbeit, c, ["liste", "--alle"], "Keine Aufgaben.\n")
    ok(prog, arbeit, c, ["statistik"],
       "Gesamt: 0, offen: 0, erledigt: 0 (0 %)\n"
       "Offen nach Priorität: hoch 0, normal 0, niedrig 0\n")
    if os.path.exists(c):
        fail("liste/statistik haben eine Datei angelegt")
    fehler(prog, arbeit, c, ["erledigt", "1"], "Fehler: Aufgabe 1 nicht gefunden.")


def szenario_vorbereitet(prog, tmp):
    """Vorbereitete Datei: naechste_id wird aus der Datei gelesen."""
    arbeit = neuer_ordner(tmp, "arbeit_d")
    d = os.path.join(tmp, "d.json")
    schreibe_datei(d, {"naechste_id": 10, "aufgaben": [
        aufg(3, "Älteres Ding", "niedrig", False), aufg(7, "Größeres Ding", "hoch", True)]})
    ok(prog, arbeit, d, ["neu", "x"], "Aufgabe 10 angelegt.\n")
    ok(prog, arbeit, d, ["liste", "--alle"],
       " 10. [ ] ( ) x\n"
       "  3. [ ] (-) Älteres Ding\n"
       "  7. [x] (!) Größeres Ding\n")
    daten = lese_datei(d, "Szenario D")
    if daten.get("naechste_id") != 11 or [t["id"] for t in daten.get("aufgaben", [])] != [3, 7, 10]:
        fail("naechste_id/IDs nach neu in vorbereiteter Datei falsch")


def szenario_prozente(prog, tmp):
    """Kaufmaennische Rundung der Prozentzahl, Zaehlung der offenen Aufgaben je Prioritaet."""
    arbeit = neuer_ordner(tmp, "arbeit_p")
    for gesamt, erledigt, prozent in ((8, 1, 13), (8, 3, 38), (3, 2, 67), (40, 1, 3), (7, 7, 100)):
        p = os.path.join(tmp, f"p{gesamt}_{erledigt}.json")
        liste = [aufg(i, f"Aufgabe {i}", ["hoch", "normal", "niedrig"][i % 3], i <= erledigt)
                 for i in range(1, gesamt + 1)]
        schreibe_datei(p, {"naechste_id": gesamt + 1, "aufgaben": liste})
        offen = [t for t in liste if not t["erledigt"]]
        n = {k: sum(1 for t in offen if t["prio"] == k) for k in ("hoch", "normal", "niedrig")}
        ok(prog, arbeit, p, ["statistik"],
           f"Gesamt: {gesamt}, offen: {len(offen)}, erledigt: {erledigt} ({prozent} %)\n"
           f"Offen nach Priorität: hoch {n['hoch']}, normal {n['normal']}, niedrig {n['niedrig']}\n")


def szenario_fehler(prog, tmp):
    """Fehlerfaelle: leerer Text, ungueltige Aufrufe (Exit-Code 2), kaputte Datei."""
    arbeit = neuer_ordner(tmp, "arbeit_e")
    e = os.path.join(tmp, "e.json")
    start_e = {"naechste_id": 2, "aufgaben": [aufg(1, "bleibt", "normal", False)]}
    schreibe_datei(e, start_e)
    fehler(prog, arbeit, e, ["neu", ""], "Fehler: Text darf nicht leer sein.")
    fehler(prog, arbeit, e, ["neu", "   "], "Fehler: Text darf nicht leer sein.")
    if lese_datei(e, "Szenario E") != start_e:
        fail("fehlgeschlagenes neu hat die Datei veraendert")
    for args in (["neu", "x", "--prio", "extrem"], ["erledigt", "abc"], ["gibtesnicht"], []):
        fehler(prog, arbeit, e, args, None, rc_soll=2)
    if lese_datei(e, "Szenario E") != start_e:
        fail("ungueltiger Aufruf hat die Datei veraendert")
    f = os.path.join(tmp, "f.json")
    kaputt = "{kaputt".encode("utf-8")
    for args in (["liste"], ["neu", "x"]):
        with open(f, "wb") as fh:
            fh.write(kaputt)
        fehler(prog, arbeit, f, args, "Fehler: Aufgabendatei ist kaputt.")
        with open(f, "rb") as fh:
            if fh.read() != kaputt:
                fail("kaputte Datei wurde veraendert")


def eigene_tests(cwd, test_pfad, tmp):
    with open(test_pfad, encoding="utf-8", errors="replace") as fh:
        quelle = fh.read()
    n_tests = len(re.findall(r"(?m)^\s*def test_\w*\(", quelle))
    if n_tests < 6:
        fail(f"test_aufgaben.py hat nur {n_tests} Testfunktionen (mind. 6)")
    n_assert = len(re.findall(r"(?m)^\s*assert\b", quelle))
    if n_assert < 6:
        fail(f"test_aufgaben.py hat nur {n_assert} assert (mind. 6)")
    if "aufgaben" not in quelle.replace("test_aufgaben", ""):
        fail("test_aufgaben.py nimmt keinen Bezug auf aufgaben.py")
    kopie = os.path.join(tmp, "kopie")
    shutil.copytree(cwd, kopie, ignore=shutil.ignore_patterns("__pycache__", ".git", "node_modules", "*.pyc"))
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    try:
        r = subprocess.run(
            [sys.executable, "-B", os.path.join(kopie, "test_aufgaben.py")],
            cwd=kopie, capture_output=True, timeout=40, env=env,
        )
    except subprocess.TimeoutExpired:
        fail("python test_aufgaben.py dauert zu lange")
    if r.returncode != 0:
        err = r.stderr.decode("utf-8", "replace").strip().splitlines()
        fail(f"python test_aufgaben.py Exit-Code {r.returncode} {err[-1] if err else ''}")


def main():
    cwd = os.getcwd()
    skript = os.path.join(cwd, "aufgaben.py")
    test_pfad = os.path.join(cwd, "test_aufgaben.py")
    if not os.path.isfile(skript):
        fail("aufgaben.py fehlt")
    if not os.path.isfile(test_pfad):
        fail("test_aufgaben.py fehlt")
    prog = Prog(skript)

    with tempfile.TemporaryDirectory() as tmp:
        # Die Szenarien sind voneinander unabhaengig (eigene Dateien/Ordner) und laufen
        # parallel; gemeldet wird immer der erste Fehler in dieser festen Reihenfolge.
        aufgaben = [
            lambda: szenario_a(prog, tmp),
            lambda: szenario_standarddatei(prog, tmp),
            lambda: szenario_vorbereitet(prog, tmp),
            lambda: szenario_prozente(prog, tmp),
            lambda: szenario_fehler(prog, tmp),
            lambda: eigene_tests(cwd, test_pfad, tmp),
        ]
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = [pool.submit(a) for a in aufgaben]
            for fut in futures:
                fut.result()
    print("OK")


try:
    main()
except CheckFehler as e:
    s = " ".join(str(e).split())[:200].encode("ascii", "backslashreplace").decode("ascii")
    print("FAIL: " + s)
    sys.exit(1)
except Exception as e:
    s = " ".join(f"{type(e).__name__}: {e}".split())[:200].encode("ascii", "backslashreplace").decode("ascii")
    print("FAIL: " + s)
    sys.exit(1)
