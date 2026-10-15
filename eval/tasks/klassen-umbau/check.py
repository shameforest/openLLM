import ast
import hashlib
import os
import subprocess
import sys

sys.dont_write_bytecode = True

# SHA-256 der Original-main.py (Zeilenenden auf LF normalisiert)
MAIN_SHA256 = "55e450e4c9d182475c78b53a27da00ecaedb3caefdb29fff675eb4a8557ee928"

# Ausgabe des Original-Programms `python main.py` (LF-Zeilenenden)
MAIN_AUSGABE = r'''-> Konten: 1001 und 1002
-> Stand Ben nach Abhebung: 5050
-> Fehler ValueError: Nicht genug Guthaben auf Konto 1002
-> Fehler KeyError: Unbekanntes Konto 9999
-> Fehler ValueError: Quell- und Zielkonto sind gleich
-> Fehler ValueError: Betrag muss eine positive ganze Zahl (Cent) sein
-> Stand Anna: 7000
-> Stand Ben: 5050
Kontoauszug 1001 (Anna Müller)
#001 Eröffnung                 +100.00     100.00
#003 Überweisung an 1002        -30.00      70.00
Saldo: 70.00
Kontoauszug 1002 (Ben Özdemir)
#002 Einzahlung                 +25.50      25.50
#004 Überweisung von 1001       +30.00      55.50
#005 Abhebung                    -5.00      50.50
Saldo: 50.50
'''

# Probe-Skript: ruft alle Operationen (auch Fehlerfaelle, Schluesselwort-Aufrufe) auf
# `konten` (Modus "modul") bzw. auf `konten.Bank()` (Modus "bank") auf und gibt alles aus.
PROBE = r'''import sys
import konten

modus = sys.argv[1]
api = konten if modus == "modul" else konten.Bank()


def zeige(name, f, *args):
    try:
        r = f(*args)
    except Exception as e:
        print(name, "->", type(e).__name__, e.args[0] if e.args else "")
    else:
        print(name, "->", repr(r))


zeige("eroeffnen anna", api.eroeffnen, "Anna Müller", 10000)
zeige("eroeffnen ben", api.eroeffnen, "  Ben Özdemir ")
zeige("eroeffnen cem", lambda: api.eroeffnen(inhaber="Cem", startguthaben=500))
zeige("eroeffnen leer", api.eroeffnen, "   ")
zeige("eroeffnen negativ", api.eroeffnen, "Dora", -1)
zeige("eroeffnen bool", api.eroeffnen, "Dora", True)
zeige("einzahlen", api.einzahlen, 1002, 2550)
zeige("einzahlen kw", lambda: api.einzahlen(nr=1001, betrag=1))
zeige("einzahlen null", api.einzahlen, 1001, 0)
zeige("einzahlen float", api.einzahlen, 1001, 1.5)
zeige("einzahlen unbekannt", api.einzahlen, 4711, 100)
zeige("einzahlen unbekannt negativ", api.einzahlen, 4711, -1)
zeige("abheben", api.abheben, 1001, 2500)
zeige("abheben zu viel", api.abheben, 1002, 100000)
zeige("abheben unbekannt", api.abheben, 4711, 1)
zeige("abheben unbekannt null", api.abheben, 4711, 0)
zeige("abheben kw", lambda: api.abheben(nr=1003, betrag=500))
zeige("ueberweisen", api.ueberweisen, 1001, 1002, 1000)
zeige("ueberweisen kw", lambda: api.ueberweisen(von_nr=1002, nach_nr=1001, betrag=50))
zeige("ueberweisen leeres konto", api.ueberweisen, 1003, 1001, 1)
zeige("ueberweisen gleich", api.ueberweisen, 1001, 1001, 5)
zeige("ueberweisen gleich unbekannt", api.ueberweisen, 7777, 7777, 5)
zeige("ueberweisen gleich null", api.ueberweisen, 7777, 7777, 0)
zeige("ueberweisen ziel unbekannt", api.ueberweisen, 1001, 7777, 5)
zeige("ueberweisen ziel unbekannt zu viel", api.ueberweisen, 1003, 7777, 100)
zeige("ueberweisen quelle unbekannt", api.ueberweisen, 7777, 1001, 5)
zeige("ueberweisen negativ", api.ueberweisen, 1001, 1002, -5)
zeige("kontostand 1001", api.kontostand, 1001)
zeige("kontostand 1002", api.kontostand, 1002)
zeige("kontostand 1003", api.kontostand, 1003)
zeige("kontostand 1004", api.kontostand, 1004)
zeige("kontostand kw", lambda: api.kontostand(nr=1002))
for nr in (1001, 1002, 1003):
    for zeile in api.auszug(nr):
        print(zeile)
zeige("auszug kw", lambda: api.auszug(nr=1003))
zeige("auszug unbekannt", api.auszug, 7777)
'''

# erwartete Ausgabe des Probe-Skripts, erzeugt mit dem Original-Code (Modul-Funktionen)
PROBE_ERWARTET = r'''eroeffnen anna -> 1001
eroeffnen ben -> 1002
eroeffnen cem -> 1003
eroeffnen leer -> ValueError Inhaber fehlt
eroeffnen negativ -> ValueError Startguthaben darf nicht negativ sein
eroeffnen bool -> ValueError Startguthaben darf nicht negativ sein
einzahlen -> 2550
einzahlen kw -> 10001
einzahlen null -> ValueError Betrag muss eine positive ganze Zahl (Cent) sein
einzahlen float -> ValueError Betrag muss eine positive ganze Zahl (Cent) sein
einzahlen unbekannt -> KeyError Unbekanntes Konto 4711
einzahlen unbekannt negativ -> ValueError Betrag muss eine positive ganze Zahl (Cent) sein
abheben -> 7501
abheben zu viel -> ValueError Nicht genug Guthaben auf Konto 1002
abheben unbekannt -> KeyError Unbekanntes Konto 4711
abheben unbekannt null -> ValueError Betrag muss eine positive ganze Zahl (Cent) sein
abheben kw -> 0
ueberweisen -> None
ueberweisen kw -> None
ueberweisen leeres konto -> ValueError Nicht genug Guthaben auf Konto 1003
ueberweisen gleich -> ValueError Quell- und Zielkonto sind gleich
ueberweisen gleich unbekannt -> ValueError Quell- und Zielkonto sind gleich
ueberweisen gleich null -> ValueError Betrag muss eine positive ganze Zahl (Cent) sein
ueberweisen ziel unbekannt -> KeyError Unbekanntes Konto 7777
ueberweisen ziel unbekannt zu viel -> KeyError Unbekanntes Konto 7777
ueberweisen quelle unbekannt -> KeyError Unbekanntes Konto 7777
ueberweisen negativ -> ValueError Betrag muss eine positive ganze Zahl (Cent) sein
kontostand 1001 -> 6551
kontostand 1002 -> 3500
kontostand 1003 -> 0
kontostand 1004 -> KeyError Unbekanntes Konto 1004
kontostand kw -> 3500
Kontoauszug 1001 (Anna Müller)
#001 Eröffnung                 +100.00     100.00
#004 Einzahlung                  +0.01     100.01
#005 Abhebung                   -25.00      75.01
#007 Überweisung an 1002        -10.00      65.01
#010 Überweisung von 1002        +0.50      65.51
Saldo: 65.51
Kontoauszug 1002 (Ben Özdemir)
#003 Einzahlung                 +25.50      25.50
#008 Überweisung von 1001       +10.00      35.50
#009 Überweisung an 1001         -0.50      35.00
Saldo: 35.00
Kontoauszug 1003 (Cem)
#002 Eröffnung                   +5.00       5.00
#006 Abhebung                    -5.00       0.00
Saldo: 0.00
auszug kw -> ['Kontoauszug 1003 (Cem)', '#002 Eröffnung                   +5.00       5.00', '#006 Abhebung                    -5.00       0.00', 'Saldo: 0.00']
auszug unbekannt -> KeyError Unbekanntes Konto 7777
'''

# Unabhaengigkeit der Instanzen, Atomaritaet, Zustand auf Modulebene
PROBE2 = r'''import collections
import itertools
import sys

import konten


def fehler(msg):
    print("FAIL: " + msg)
    sys.exit(1)


def wirft(typ, f, *args):
    try:
        f(*args)
    except typ:
        return True
    return False


if not isinstance(getattr(konten, "Bank", None), type):
    fehler("konten.Bank fehlt oder ist keine Klasse")
Bank = konten.Bank

# Modulebene: kein veraenderlicher Zustand ausser genau einer Standard-Instanz
for name, wert in vars(konten).items():
    if name.startswith("__"):
        continue
    if isinstance(wert, (dict, list, set, bytearray, collections.deque, itertools.count)):
        fehler(f"Modulvariable {name} ist veraenderlicher Zustand ({type(wert).__name__})")
anzahl = len({id(w) for n, w in vars(konten).items() if not n.startswith("__") and isinstance(w, Bank)})
if anzahl != 1:
    fehler(f"{anzahl} Bank-Instanzen auf Modulebene, erwartet genau eine Standard-Instanz")
for name, wert in vars(Bank).items():
    if not name.startswith("__") and isinstance(wert, (dict, list, set, bytearray, collections.deque, itertools.count)):
        fehler(f"Klassenvariable {name} wuerde zwischen Instanzen geteilt")
for name in ("eroeffnen", "einzahlen", "abheben", "ueberweisen", "kontostand", "auszug"):
    if not callable(getattr(konten, name, None)):
        fehler(f"konten.{name} fehlt")
    if not callable(getattr(Bank, name, None)):
        fehler(f"Bank.{name} fehlt")

# zwei unabhaengige Banken
b1, b2 = Bank(), Bank()
if b1 is b2:
    fehler("Bank() liefert immer dieselbe Instanz")
n1 = b1.eroeffnen("Eins", 1000)
n2 = b2.eroeffnen("Zwei", 500)
if (n1, n2) != (1001, 1001):
    fehler(f"erste Kontonummern zweier Banken: {n1} und {n2}, erwartet 1001 und 1001")
if b1.eroeffnen("Drei") != 1002:
    fehler("zweite Kontonummer in Bank 1 falsch")
if not wirft(KeyError, b2.kontostand, 1002):
    fehler("Bank 2 kennt Konto 1002 aus Bank 1 (geteilter Zustand)")
b1.einzahlen(1001, 50)
if b2.kontostand(1001) != 500:
    fehler("Einzahlung in Bank 1 veraendert Bank 2")
b2.abheben(1001, 100)
if b1.kontostand(1001) != 1050 or b2.kontostand(1001) != 400:
    fehler("Kontostaende nach getrennten Buchungen falsch")
if b1.auszug(1001) != ['Kontoauszug 1001 (Eins)', '#001 Eröffnung                  +10.00      10.00', '#002 Einzahlung                  +0.50      10.50', 'Saldo: 10.50']:
    fehler("Auszug Bank 1 (Buchungsnummern muessen je Bank bei 1 beginnen)")
if b2.auszug(1001) != ['Kontoauszug 1001 (Zwei)', '#001 Eröffnung                   +5.00       5.00', '#002 Abhebung                    -1.00       4.00', 'Saldo: 4.00']:
    fehler("Auszug Bank 2 (Buchungsnummern muessen je Bank bei 1 beginnen)")
b3 = Bank()
if b3.eroeffnen("Neu") != 1001 or not wirft(KeyError, b3.kontostand, 1002):
    fehler("dritte Bank startet nicht leer")

# Ueberweisungen sind atomar
b4 = Bank()
a = b4.eroeffnen("A", 100)
b = b4.eroeffnen("B", 0)
vorher = (b4.auszug(a), b4.auszug(b), b4.kontostand(a), b4.kontostand(b))
for args in ((a, b, 101), (a, a, 1), (a, 9999, 1), (9999, a, 1), (a, b, 0), (a, b, -3)):
    if not wirft((ValueError, KeyError), b4.ueberweisen, *args):
        fehler(f"ueberweisen{args} wirft keinen Fehler")
if (b4.auszug(a), b4.auszug(b), b4.kontostand(a), b4.kontostand(b)) != vorher:
    fehler("fehlgeschlagene Ueberweisung hat etwas verbucht")
b4.ueberweisen(a, b, 100)
if repr(b4.auszug(a)) != "['Kontoauszug 1001 (A)', '#001 Eröffnung                   +1.00       1.00', '#002 Überweisung an 1002         -1.00       0.00', 'Saldo: 0.00']" or repr(b4.auszug(b)) != "['Kontoauszug 1002 (B)', '#003 Überweisung von 1001        +1.00       1.00', 'Saldo: 1.00']":
    fehler("Auszug nach Ueberweisung weicht vom Original ab")

# die Banken haben die Standard-Instanz der Modulfunktionen nicht angefasst
if konten.eroeffnen("Standard", 1) != 1001:
    fehler("Modulfunktion eroeffnen: erste Kontonummer nicht 1001 (Banken teilen Zustand mit dem Modul)")
if repr(konten.auszug(1001)) != "['Kontoauszug 1001 (Standard)', '#001 Eröffnung                   +0.01       0.01', 'Saldo: 0.01']":
    fehler("Auszug der Modulfunktionen weicht vom Original ab")
try:
    konten.kontostand(1002)
except KeyError:
    pass
else:
    fehler("Modulfunktionen kennen Konto 1002 von einer Bank-Instanz")
# und umgekehrt
b5 = Bank()
if b5.eroeffnen("Fuenf") != 1001:
    fehler("neue Bank startet nicht bei 1001, wenn die Modulfunktionen benutzt wurden")
print("OK")
'''

MUTABLE_AUFRUFE = {"dict", "list", "set", "defaultdict", "deque", "OrderedDict", "Counter", "count", "bytearray"}


def fail(msg):
    s = " ".join(str(msg).split())[:200].encode("ascii", "backslashreplace").decode("ascii")
    print("FAIL: " + s)
    sys.exit(1)


def sha(path):
    with open(path, "rb") as f:
        data = f.read().replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def starte(cwd, args, code=None):
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    cmd = [sys.executable, "-B"] + (["-c", code] if code is not None else []) + args
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, timeout=10, env=env)
    except subprocess.TimeoutExpired:
        fail("Programm dauert zu lange")
    out = r.stdout.decode("utf-8", "replace").replace("\r\n", "\n")
    err = r.stderr.decode("utf-8", "replace").strip().splitlines()
    return r.returncode, out, (err[-1] if err else "")


def erste_abweichung(ist, soll):
    a, b = ist.splitlines(), soll.splitlines()
    for i in range(max(len(a), len(b))):
        x = a[i] if i < len(a) else "<fehlt>"
        y = b[i] if i < len(b) else "<fehlt>"
        if x != y:
            return f"Zeile {i + 1}: {x!r} statt {y!r}"
    return "?"


def main():
    cwd = os.getcwd()
    pfad = os.path.join(cwd, "konten.py")
    main_pfad = os.path.join(cwd, "main.py")
    if not os.path.isfile(pfad):
        fail("konten.py fehlt")
    if not os.path.isfile(main_pfad):
        fail("main.py fehlt")
    if sha(main_pfad) != MAIN_SHA256:
        fail("main.py wurde veraendert")

    # --- statische Pruefung: class Bank, kein global, kein veraenderlicher Modulzustand
    with open(pfad, encoding="utf-8") as f:
        quelle = f.read()
    try:
        baum = ast.parse(quelle)
    except SyntaxError as e:
        fail(f"konten.py hat einen Syntaxfehler: {e.msg} (Zeile {e.lineno})")
    if not any(isinstance(k, ast.ClassDef) and k.name == "Bank" for k in baum.body):
        fail("konten.py enthaelt keine Klasse Bank")
    for knoten in ast.walk(baum):
        if isinstance(knoten, ast.Global):
            fail(f"konten.py benutzt global (Zeile {knoten.lineno}): Zustand gehoert in die Bank-Instanz")
    for knoten in baum.body:
        if isinstance(knoten, (ast.Assign, ast.AnnAssign)):
            wert = knoten.value
            if isinstance(wert, (ast.Dict, ast.List, ast.Set, ast.DictComp, ast.ListComp, ast.SetComp)):
                fail(f"veraenderlicher Zustand auf Modulebene (Zeile {knoten.lineno})")
            if isinstance(wert, ast.Call):
                f_ = wert.func
                name = f_.id if isinstance(f_, ast.Name) else (f_.attr if isinstance(f_, ast.Attribute) else "")
                if name in MUTABLE_AUFRUFE:
                    fail(f"veraenderlicher Zustand auf Modulebene (Zeile {knoten.lineno})")

    # --- main.py: Ausgabe unveraendert
    rc, out, err = starte(cwd, [main_pfad])
    if rc != 0:
        fail(f"python main.py Exit-Code {rc} {err}")
    if out != MAIN_AUSGABE:
        fail("main.py Ausgabe weicht ab, " + erste_abweichung(out, MAIN_AUSGABE))

    # --- Modulfunktionen (Wrapper) und Bank-Instanz verhalten sich wie das Original
    for modus in ("modul", "bank"):
        rc, out, err = starte(cwd, [modus], code=PROBE)
        if rc != 0:
            fail(f"Probe ({modus}) Exit-Code {rc} {err}")
        if out != PROBE_ERWARTET:
            fail(f"Probe ({modus}) weicht vom Original ab, " + erste_abweichung(out, PROBE_ERWARTET))

    # --- Unabhaengigkeit, Atomaritaet, kein Zustand auf Modulebene
    rc, out, err = starte(cwd, [], code=PROBE2)
    if rc != 0:
        meldung = out.strip().splitlines()[-1] if out.strip() else err
        fail(meldung[6:] if meldung.startswith("FAIL: ") else f"Pruefskript Exit-Code {rc} {meldung}")
    if out.strip() != "OK":
        fail("Pruefskript: unerwartete Ausgabe " + out.strip()[:80])
    print("OK")


try:
    main()
except SystemExit:
    raise
except Exception as e:
    fail(f"{type(e).__name__}: {e}")
