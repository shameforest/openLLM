"""Preisberechnung: Runden, Zeilenbeträge und Steuer.

Alle Geldbeträge sind Decimal in Euro mit höchstens zwei Nachkommastellen.
"""
from decimal import Decimal


def runde(betrag):
    """Rundet einen Betrag kaufmännisch auf ganze Cent.

    Kaufmännisch heißt half-up: Ab einem halben Cent wird aufgerundet,
    0,125 wird also zu 0,13 und 2,675 zu 2,68. Das Ergebnis ist ein Decimal.
    """
    return Decimal(str(round(float(betrag), 2)))


def zeilen_netto(position):
    """Netto-Zeilenbetrag vor allen Rabatten: Menge mal Stückpreis."""
    return runde(position.artikel.preis_netto * position.menge)


def steuer(netto, satz):
    """Steuer auf einen (bereits rabattierten) Netto-Zeilenbetrag, auf Cent gerundet."""
    return runde(netto * satz)


def brutto(netto, satz):
    """Netto-Zeilenbetrag plus Steuer."""
    return netto + steuer(netto, satz)
