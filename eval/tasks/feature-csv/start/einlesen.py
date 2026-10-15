"""Einlesen der Verkaufs-CSV (Semikolon-getrennt, deutsche Dezimalzahlen)."""
import csv
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

SPALTEN = ["datum", "kategorie", "produkt", "menge", "einzelpreis"]


@dataclass
class Verkauf:
    """Eine Zeile der CSV. Die Menge ist negativ, wenn es eine Retoure war."""

    datum: date
    kategorie: str
    produkt: str
    menge: int
    einzelpreis: Decimal

    @property
    def monat(self):
        """Monat als Text, zum Beispiel '2025-03'."""
        return self.datum.strftime("%Y-%m")

    @property
    def umsatz(self):
        return self.menge * self.einzelpreis


def parse_betrag(text):
    """Wandelt einen deutschen Betrag in Decimal um: '1.299,00' -> Decimal('1299.00')."""
    sauber = text.strip().replace(".", "").replace(",", ".")
    try:
        return Decimal(sauber)
    except InvalidOperation:
        raise ValueError(f"ungültiger Betrag {text!r}") from None


def lese_verkaeufe(pfad):
    """Liest die CSV und gibt eine Liste von Verkauf-Objekten zurück.

    Die Datei darf mit einem BOM beginnen und Leerzeilen enthalten.
    Fehlerhafte Zeilen lösen ValueError mit der Zeilennummer aus.
    """
    verkaeufe = []
    with open(pfad, encoding="utf-8-sig", newline="") as f:
        leser = csv.reader(f, delimiter=";")
        kopf = next(leser, None)
        if kopf is None or [s.strip().lower() for s in kopf] != SPALTEN:
            raise ValueError("Tabellenkopf muss " + ";".join(SPALTEN) + " lauten")
        for nummer, zeile in enumerate(leser, start=2):
            if not any(feld.strip() for feld in zeile):
                continue
            if len(zeile) != len(SPALTEN):
                raise ValueError(f"Zeile {nummer}: {len(SPALTEN)} Spalten erwartet")
            try:
                datum = datetime.strptime(zeile[0].strip(), "%d.%m.%Y").date()
                menge = int(zeile[3].strip())
                preis = parse_betrag(zeile[4])
            except ValueError as fehler:
                raise ValueError(f"Zeile {nummer}: {fehler}") from None
            verkaeufe.append(Verkauf(datum, zeile[1].strip(), zeile[2].strip(), menge, preis))
    return verkaeufe
