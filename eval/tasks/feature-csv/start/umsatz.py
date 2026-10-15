"""Umsatz-Auswertung: summiert eine Verkaufs-CSV je Monat und gibt eine Tabelle aus.

Aufruf: python umsatz.py [datei.csv] [--ab JJJJ-MM]
"""
import argparse
import re
import sys
from decimal import Decimal

import ausgabe
from einlesen import lese_verkaeufe

STANDARD_DATEI = "verkaeufe.csv"


def summiere_monate(verkaeufe):
    """Summiert die Verkäufe je Monat.

    Ergebnis: Liste von (monat, anzahl_zeilen, summe_menge, summe_umsatz),
    aufsteigend nach Monat sortiert.
    """
    summen = {}
    for v in verkaeufe:
        anzahl, menge, umsatz = summen.get(v.monat, (0, 0, Decimal(0)))
        summen[v.monat] = (anzahl + 1, menge + v.menge, umsatz + v.umsatz)
    return [(monat, *summen[monat]) for monat in sorted(summen)]


def baue_parser():
    parser = argparse.ArgumentParser(
        prog="umsatz.py", description="Summiert eine Verkaufs-CSV je Monat."
    )
    parser.add_argument(
        "datei", nargs="?", default=STANDARD_DATEI, help="CSV-Datei (Standard: verkaeufe.csv)"
    )
    parser.add_argument(
        "--ab", metavar="JJJJ-MM", help="nur Verkäufe ab diesem Monat (einschließlich)"
    )
    return parser


def main(argv=None):
    parser = baue_parser()
    args = parser.parse_args(argv)
    if args.ab is not None and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", args.ab):
        parser.error("--ab erwartet das Format JJJJ-MM")

    try:
        verkaeufe = lese_verkaeufe(args.datei)
    except FileNotFoundError:
        print(f"Fehler: Datei nicht gefunden: {args.datei}", file=sys.stderr)
        return 2
    except ValueError as fehler:
        print(f"Fehler: {fehler}", file=sys.stderr)
        return 2

    if args.ab is not None:
        verkaeufe = [v for v in verkaeufe if v.monat >= args.ab]

    zeilen = summiere_monate(verkaeufe)
    if not zeilen:
        print("Keine Verkäufe.")
        return 0
    print(ausgabe.tabelle(zeilen))
    return 0


if __name__ == "__main__":
    sys.exit(main())
