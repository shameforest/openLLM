"""Datenmodelle des Shops: Artikel, Positionen und Kunden."""
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class Artikel:
    """Ein Artikel im Sortiment.

    preis_netto ist der Stückpreis in Euro ohne Steuer, steuersatz der
    Steuersatz als Anteil (Decimal("0.19") für 19 %, Decimal("0.07") für 7 %).
    """

    nr: str
    name: str
    preis_netto: Decimal
    steuersatz: Decimal = Decimal("0.19")


@dataclass
class Position:
    """Eine Zeile einer Bestellung: ein Artikel und eine Menge (mindestens 1)."""

    artikel: Artikel
    menge: int

    def __post_init__(self):
        if not isinstance(self.menge, int) or self.menge < 1:
            raise ValueError("Menge muss eine ganze Zahl >= 1 sein")


@dataclass
class Kunde:
    """Ein Kunde. Stammkunden bekommen zusätzlich einen Stammkundenrabatt."""

    name: str
    stammkunde: bool = False
