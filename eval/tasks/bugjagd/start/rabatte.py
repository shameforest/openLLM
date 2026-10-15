"""Rabatte: Mengenrabatt, Stammkundenrabatt und Wertgutschein.

Regeln (so stehen sie in den AGB):

1. Mengenrabatt je Position, abhängig von der Menge dieser Position:
   ab 10 Stück 5 %, ab 50 Stück 10 %.
2. Stammkundenrabatt: 5 % auf den Betrag, der nach dem Mengenrabatt übrig ist.
   Die Rabatte wirken also nacheinander, die Prozentsätze werden nicht addiert.
   Nach jedem Schritt wird kaufmännisch auf ganze Cent gerundet.
   Der Stammkundenrabatt wird pro Position genau einmal abgezogen.
3. Ein Wertgutschein (fester Euro-Betrag) wird ganz zuletzt von der
   Brutto-Summe der Rechnung abgezogen. Der Rechnungsbetrag wird nie negativ.
"""
from decimal import Decimal

from preise import runde

STAMMKUNDEN_PROZENT = Decimal("5")

# (ab Menge, Prozent), absteigend nach Menge sortiert
MENGENSTAFFEL = [(50, Decimal("10")), (10, Decimal("5"))]


def mengenrabatt_prozent(menge):
    """Prozentsatz des Mengenrabatts für eine Positionsmenge."""
    for ab, prozent in MENGENSTAFFEL:
        if menge >= ab:
            return prozent
    return Decimal("0")


def abziehen_prozent(betrag, prozent):
    """Zieht prozent Prozent vom Betrag ab und rundet das Ergebnis auf Cent."""
    return runde(betrag * (Decimal("100") - prozent) / Decimal("100"))


def anwenden(netto, menge, stammkunde):
    """Wendet Mengenrabatt und (bei Stammkunden) Stammkundenrabatt auf einen
    Netto-Zeilenbetrag an und gibt den rabattierten Netto-Betrag zurück."""
    betrag = abziehen_prozent(netto, mengenrabatt_prozent(menge))
    if stammkunde:
        betrag = abziehen_prozent(betrag, STAMMKUNDEN_PROZENT)
    return betrag


def gutschein_abziehen(brutto_summe, gutschein):
    """Zieht einen Wertgutschein von der Brutto-Summe ab (nie unter 0)."""
    return max(brutto_summe - gutschein, Decimal("0"))
