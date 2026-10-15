"""Bestellungen aufgeben und Rechnungen erzeugen."""
from decimal import Decimal

import preise
import rabatte
from models import Position

NULL = Decimal("0")


class Bestellung:
    """Eine Bestellung eines Kunden gegen ein Lager.

    Ablauf der Rechnung je Position: Netto-Zeilenbetrag, dann die Rabatte
    (rabatte.anwenden), dann die Steuer auf den rabattierten Betrag.
    Ein Wertgutschein wird erst zuletzt von der Brutto-Summe abgezogen.
    """

    def __init__(self, kunde, lager, gutschein=NULL):
        self.kunde = kunde
        self.lager = lager
        self.gutschein = Decimal(gutschein)
        self.positionen = []

    def hinzufuegen(self, artikel, menge):
        """Fügt eine Position hinzu. Derselbe Artikel darf mehrfach vorkommen."""
        self.positionen.append(Position(artikel, menge))

    def _zeile(self, position):
        artikel = position.artikel
        netto = preise.zeilen_netto(position)
        netto = rabatte.anwenden(netto, position.menge, self.kunde.stammkunde)
        if self.kunde.stammkunde:
            netto = rabatte.abziehen_prozent(netto, rabatte.STAMMKUNDEN_PROZENT)
        steuer = preise.steuer(netto, artikel.steuersatz)
        return {
            "nr": artikel.nr,
            "menge": position.menge,
            "netto": netto,
            "steuer": steuer,
            "brutto": netto + steuer,
        }

    def rechnung(self):
        """Berechnet die Rechnung, ohne etwas zu reservieren.

        Ergebnis: dict mit "zeilen" (je Position nr, menge, netto, steuer, brutto),
        den Summen "netto", "steuer", "brutto", dem tatsächlich abgezogenen
        "gutschein" und dem Rechnungsbetrag "zu_zahlen".
        """
        zeilen = [self._zeile(p) for p in self.positionen]
        netto = sum((z["netto"] for z in zeilen), NULL)
        steuer = sum((z["steuer"] for z in zeilen), NULL)
        brutto = netto + steuer
        zu_zahlen = rabatte.gutschein_abziehen(brutto, self.gutschein)
        return {
            "zeilen": zeilen,
            "netto": netto,
            "steuer": steuer,
            "brutto": brutto,
            "gutschein": brutto - zu_zahlen,
            "zu_zahlen": zu_zahlen,
        }

    def aufgeben(self):
        """Reserviert die Ware (ganz oder gar nicht) und liefert die Rechnung."""
        if not self.positionen:
            raise ValueError("Bestellung ist leer")
        self.lager.reservieren(self.positionen)
        return self.rechnung()
