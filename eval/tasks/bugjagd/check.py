import hashlib
import os
import random
import subprocess
import sys
from decimal import Decimal

sys.dont_write_bytecode = True
sys.path.insert(0, os.getcwd())

# SHA-256 der Original-test_shop.py (Zeilenenden auf LF normalisiert)
TEST_SHA256 = "6bbf85c83b65328aa98d4a691fb5da3ec62a4eb0519c8e064c8e589d8b35ba34"


def fail(msg):
    s = " ".join(str(msg).split())[:200].encode("ascii", "backslashreplace").decode("ascii")
    print("FAIL: " + s)
    sys.exit(1)


def sha(path):
    with open(path, "rb") as f:
        data = f.read().replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def D(x):
    return Decimal(str(x))


def cents(wert, was):
    """Decimal-Betrag -> ganze Cent (int); fail, wenn kein Decimal oder nicht auf Cent gerundet."""
    if not isinstance(wert, Decimal):
        fail(f"{was}: kein Decimal ({type(wert).__name__})")
    c = wert * 100
    if c != c.to_integral_value():
        fail(f"{was}: nicht auf Cent gerundet ({wert})")
    return int(c)


# ---------------------------------------------------------------------------
# Unabhaengiges Referenzmodell in ganzen Cent (reine int-Arithmetik)
# ---------------------------------------------------------------------------
def r_mengenprozent(menge):
    return 10 if menge >= 50 else (5 if menge >= 10 else 0)


def r_abzug(c, prozent):
    # c * (100 - prozent) / 100, kaufmaennisch gerundet (half-up)
    return (c * (100 - prozent) + 50) // 100


def r_rechnung(positionen, stamm, gutschein_c):
    zeilen = []
    for preis_c, satz_pct, menge in positionen:
        n = preis_c * menge
        n = r_abzug(n, r_mengenprozent(menge))
        if stamm:
            n = r_abzug(n, 5)
        s = (n * satz_pct + 50) // 100
        zeilen.append((n, s, n + s))
    netto = sum(z[0] for z in zeilen)
    steuer = sum(z[1] for z in zeilen)
    brutto = netto + steuer
    zu = max(brutto - gutschein_c, 0)
    return zeilen, netto, steuer, brutto, brutto - zu, zu


def main():
    cwd = os.getcwd()
    test_pfad = os.path.join(cwd, "test_shop.py")
    if not os.path.isfile(test_pfad):
        fail("test_shop.py fehlt")
    if sha(test_pfad) != TEST_SHA256:
        fail("test_shop.py wurde veraendert")
    for name in ("models.py", "preise.py", "rabatte.py", "lager.py", "bestellung.py"):
        if not os.path.isfile(os.path.join(cwd, name)):
            fail(name + " fehlt")

    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    try:
        r = subprocess.run(
            [sys.executable, "-B", test_pfad], cwd=cwd, capture_output=True, timeout=10, env=env
        )
    except subprocess.TimeoutExpired:
        fail("python test_shop.py dauert zu lange")
    if r.returncode != 0:
        err = r.stderr.decode("utf-8", "replace").strip().splitlines()
        fail(f"python test_shop.py Exit-Code {r.returncode} {err[-1] if err else ''}")

    from bestellung import Bestellung
    from lager import Lager, NichtVorraetig
    from models import Artikel, Kunde, Position
    from preise import runde, steuer
    from rabatte import anwenden

    # --- (a) Runden und Steuer -------------------------------------------
    for text, erwartet in [
        ("0.125", "0.13"), ("2.675", "2.68"), ("1.005", "1.01"), ("0.285", "0.29"),
        ("0.175", "0.18"), ("0.135", "0.14"), ("0.145", "0.15"), ("8.345", "8.35"),
        ("0.5", "0.50"), ("0.004", "0.00"), ("0.005", "0.01"), ("0.994", "0.99"),
        ("1234.565", "1234.57"), ("0", "0.00"),
    ]:
        got = runde(Decimal(text))
        if not isinstance(got, Decimal) or got != Decimal(erwartet):
            fail(f"runde({text}) = {got!r}, erwartet {erwartet}")
    for netto, satz, erwartet in [
        ("1.50", "0.19", "0.29"), ("2.50", "0.07", "0.18"), ("0.50", "0.19", "0.10"),
        ("0.85", "0.19", "0.16"), ("3.50", "0.07", "0.25"), ("10.50", "0.19", "2.00"),
    ]:
        got = steuer(Decimal(netto), Decimal(satz))
        if got != Decimal(erwartet):
            fail(f"steuer({netto}, {satz}) = {got}, erwartet {erwartet}")

    # --- (b) Rabatte -----------------------------------------------------
    for netto, menge, stamm, erwartet in [
        ("100.00", 1, False, "100.00"), ("100.00", 1, True, "95.00"),
        ("100.00", 10, False, "95.00"), ("100.00", 10, True, "90.25"),
        ("100.00", 50, False, "90.00"), ("100.00", 50, True, "85.50"),
        ("33.33", 12, True, "30.08"), ("199.00", 10, True, "179.60"),
        ("17.90", 50, True, "15.30"), ("1.08", 10, True, "0.98"), ("1.06", 50, True, "0.90"),
        ("1.10", 12, True, "1.00"), ("1.08", 12, False, "1.03"),
    ]:
        got = anwenden(Decimal(netto), menge, stamm)
        if got != Decimal(erwartet):
            fail(f"anwenden({netto}, {menge}, {stamm}) = {got}, erwartet {erwartet}")

    # --- Rechnungen gegen das Referenzmodell -----------------------------
    katalog = [
        (499, 19), (150, 19), (250, 7), (1990, 7), (35, 19), (12999, 19),
        (85, 7), (1050, 19), (333, 7), (2499, 19), (5, 7), (1275, 19),
    ]
    artikel = [
        Artikel(f"X{i}", f"Artikel {i}", Decimal(p) / 100, Decimal(s) / 100)
        for i, (p, s) in enumerate(katalog)
    ]
    rnd = random.Random(20240607)
    mengen = [1, 1, 2, 3, 5, 9, 10, 11, 12, 25, 49, 50, 51, 60, 100]
    for nr in range(400):
        stamm = rnd.random() < 0.5
        gutschein_c = rnd.choice([0, 0, 500, 1990, 100000])
        anzahl = rnd.randint(1, 4)
        wahl = [(rnd.randrange(len(artikel)), rnd.choice(mengen)) for _ in range(anzahl)]
        b = Bestellung(Kunde("Test", stammkunde=stamm), Lager(), gutschein=Decimal(gutschein_c) / 100)
        for idx, menge in wahl:
            b.hinzufuegen(artikel[idx], menge)
        rech = b.rechnung()
        ref = r_rechnung([(katalog[i][0], katalog[i][1], m) for i, m in wahl], stamm, gutschein_c)
        zeilen, netto, st, brutto, gs, zu = ref
        if len(rech["zeilen"]) != len(zeilen):
            fail(f"Fall {nr}: falsche Zeilenanzahl")
        for k, (z, rz) in enumerate(zip(rech["zeilen"], zeilen)):
            for feld, soll in zip(("netto", "steuer", "brutto"), rz):
                ist = cents(z[feld], f"Fall {nr} Zeile {k} {feld}")
                if ist != soll:
                    fail(f"Fall {nr} Zeile {k} {feld}: {ist} Cent, erwartet {soll} (Stammkunde={stamm}, Positionen={wahl})")
        for feld, soll in (("netto", netto), ("steuer", st), ("brutto", brutto), ("gutschein", gs), ("zu_zahlen", zu)):
            ist = cents(rech[feld], f"Fall {nr} {feld}")
            if ist != soll:
                fail(f"Fall {nr} {feld}: {ist} Cent, erwartet {soll} (Stammkunde={stamm}, Positionen={wahl}, Gutschein={gutschein_c})")

    # --- (c) Lager: derselbe Artikel mehrfach in einer Bestellung ---------
    a = Artikel("A", "Alpha", Decimal("1.00"))
    bb = Artikel("B", "Beta", Decimal("2.00"))

    def versuche(lager, positionen):
        try:
            lager.reservieren(positionen)
        except NichtVorraetig:
            return False
        return True

    lager = Lager({"A": 5, "B": 10})
    if versuche(lager, [Position(a, 3), Position(a, 3)]):
        fail("Lager: 3+3 von 5 vorhandenen Stueck wurde reserviert (Overselling)")
    if lager.verfuegbar("A") != 5 or lager.reserviert("A") != 0:
        fail("Lager: nach abgelehnter Reservierung ist etwas reserviert")

    lager = Lager({"A": 5, "B": 10})
    if not versuche(lager, [Position(a, 3), Position(a, 2)]):
        fail("Lager: 3+2 von 5 vorhandenen Stueck wurde abgelehnt")
    if lager.verfuegbar("A") != 0 or lager.reserviert("A") != 5:
        fail(f"Lager: nach 3+2 verfuegbar={lager.verfuegbar('A')}, erwartet 0")
    if versuche(lager, [Position(a, 1)]):
        fail("Lager: weitere Reservierung bei verfuegbar 0 wurde akzeptiert")

    lager = Lager({"A": 5, "B": 10})
    if versuche(lager, [Position(bb, 1), Position(a, 3), Position(a, 3)]):
        fail("Lager: B1 + A3 + A3 von 5 wurde reserviert")
    if lager.verfuegbar("B") != 10 or lager.verfuegbar("A") != 5:
        fail("Lager: abgelehnte Bestellung hat Teile reserviert (nicht ganz oder gar nicht)")

    lager = Lager({"A": 5, "B": 10})
    if versuche(lager, [Position(a, 2), Position(bb, 1), Position(a, 2), Position(a, 2)]):
        fail("Lager: dreimal derselbe Artikel (2+2+2 von 5) wurde reserviert")
    if lager.verfuegbar("B") != 10:
        fail("Lager: B wurde trotz abgelehnter Bestellung reserviert")
    if not versuche(lager, [Position(a, 2), Position(bb, 1), Position(a, 2), Position(a, 1)]):
        fail("Lager: 2+2+1 von 5 wurde abgelehnt")
    if lager.verfuegbar("A") != 0 or lager.verfuegbar("B") != 9:
        fail("Lager: falsche Verfuegbarkeit nach gemischter Bestellung")

    lager = Lager({"A": 5})
    if not versuche(lager, [Position(a, 5)]) or lager.verfuegbar("A") != 0:
        fail("Lager: genau der Bestand (5 von 5) wird nicht reserviert")
    lager = Lager({"A": 5})
    if versuche(lager, [Position(a, 6)]):
        fail("Lager: 6 von 5 wurde reserviert")
    lager = Lager()
    if versuche(lager, [Position(a, 1)]):
        fail("Lager: unbekannter Artikel ohne Bestand wurde reserviert")

    # freigeben / ausliefern / wareneingang mit doppeltem Artikel
    lager = Lager({"A": 5})
    pos = [Position(a, 3), Position(a, 2)]
    lager.reservieren(pos)
    lager.freigeben(pos)
    if lager.verfuegbar("A") != 5:
        fail("Lager: freigeben stellt die Reservierung nicht vollstaendig zurueck")
    lager.reservieren(pos)
    lager.ausliefern(pos)
    if lager.bestand("A") != 0 or lager.reserviert("A") != 0:
        fail("Lager: ausliefern bucht Bestand/Reservierung falsch")
    lager.wareneingang("A", 4)
    if lager.verfuegbar("A") != 4:
        fail("Lager: wareneingang falsch")

    # Bestellung.aufgeben mit doppeltem Artikel
    lager = Lager({"X0": 5})
    b = Bestellung(Kunde("Test"), lager)
    b.hinzufuegen(artikel[0], 3)
    b.hinzufuegen(artikel[0], 3)
    try:
        b.aufgeben()
    except NichtVorraetig:
        pass
    else:
        fail("aufgeben: 3+3 von 5 wurde nicht abgelehnt")
    if lager.verfuegbar("X0") != 5:
        fail("aufgeben: abgelehnte Bestellung hat reserviert")
    lager = Lager({"X0": 6})
    b = Bestellung(Kunde("Test"), lager)
    b.hinzufuegen(artikel[0], 3)
    b.hinzufuegen(artikel[0], 3)
    rech = b.aufgeben()
    if lager.verfuegbar("X0") != 0:
        fail("aufgeben: 3+3 von 6 reserviert nicht alles")
    if cents(rech["netto"], "aufgeben netto") != 2 * 3 * 499:
        fail("aufgeben: Rechnung nach aufgeben falsch")

    print("OK")


try:
    main()
except SystemExit:
    raise
except Exception as e:
    fail(f"{type(e).__name__}: {e}")
