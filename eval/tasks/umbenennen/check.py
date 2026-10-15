import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.getcwd())

ALT = "berechne_preis"
NEU = "gesamtpreis"
DATEIEN = ["lager.py", "bestellung.py", "rechnung.py"]


def fail(msg):
    s = " ".join(str(msg).split())[:200].encode("ascii", "backslashreplace").decode("ascii")
    print("FAIL: " + s)
    sys.exit(1)


def gleich(got, erwartet, was):
    if got != erwartet:
        fail(f"{was} = {got!r}, erwartet {erwartet!r}")


def main():
    cwd = os.getcwd()
    for name in DATEIEN:
        pfad = os.path.join(cwd, name)
        if not os.path.isfile(pfad):
            fail(f"{name} fehlt")
        with open(pfad, encoding="utf-8") as f:
            if ALT in f.read().lower():
                fail(f"alter Name {ALT} kommt noch in {name} vor")

    import lager
    import bestellung
    import rechnung

    if not callable(getattr(lager, NEU, None)):
        fail(f"lager.{NEU} fehlt")
    if hasattr(lager, ALT):
        fail(f"lager.{ALT} existiert noch")

    gleich(lager.gesamtpreis(3, 100), 300, "gesamtpreis(3, 100)")
    gleich(lager.gesamtpreis(9, 100), 900, "gesamtpreis(9, 100)")
    gleich(lager.gesamtpreis(10, 100), 900, "gesamtpreis(10, 100)")
    gleich(lager.gesamtpreis(20, 5), 90, "gesamtpreis(20, 5)")
    gleich(lager.gesamtpreis(0, 50), 0, "gesamtpreis(0, 50)")
    gleich(lager.lagerwert([(2, 150), (10, 100)]), 1200, "lagerwert")
    gleich(lager.lagerwert([]), 0, "lagerwert([])")

    gleich(bestellung.bestellsumme([(1, 250), (10, 100), (3, 10)]), 1180, "bestellsumme")
    gleich(bestellung.bestellsumme([]), 0, "bestellsumme([])")
    gleich(bestellung.bestelltext("Schraube", 10, 100), "Schraube: 10 x 100 = 900", "bestelltext")
    gleich(bestellung.bestelltext("Nagel", 2, 7), "Nagel: 2 x 7 = 14", "bestelltext 2")

    z1 = rechnung.rechnungszeile("Mutter", 12, 50)
    gleich(tuple(z1), ("Mutter", 12, 540), "rechnungszeile")
    z2 = rechnung.rechnungszeile("Scheibe", 4, 25)
    gleich(tuple(z2), ("Scheibe", 4, 100), "rechnungszeile 2")
    gleich(rechnung.rechnungssumme([z1, z2]), 640, "rechnungssumme")
    print("OK")


try:
    main()
except SystemExit:
    raise
except Exception as e:
    fail(f"{type(e).__name__}: {e}")
