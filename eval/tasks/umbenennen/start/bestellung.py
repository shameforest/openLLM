"""Bestellungen: Summe und Text einer Bestellung."""

from lager import berechne_preis


def bestellsumme(positionen):
    """positionen ist eine Liste von (menge, einzelpreis). Gibt die Summe in Cent zurück."""
    gesamt = 0
    for menge, einzelpreis in positionen:
        gesamt += berechne_preis(menge, einzelpreis)
    return gesamt


def bestelltext(name, menge, einzelpreis):
    """Eine Textzeile für eine einzelne Bestellposition."""
    return f"{name}: {menge} x {einzelpreis} = {berechne_preis(menge, einzelpreis)}"
