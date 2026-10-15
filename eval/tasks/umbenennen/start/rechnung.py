"""Rechnungen: Zeilen und Summen."""

import lager


def rechnungszeile(bezeichnung, menge, einzelpreis):
    """Eine Rechnungszeile. Der Preis kommt aus lager.berechne_preis."""
    preis = lager.berechne_preis(menge, einzelpreis)
    return (bezeichnung, menge, preis)


def rechnungssumme(zeilen):
    """Summe der Preise (dritter Wert) aller Zeilen."""
    return sum(zeile[2] for zeile in zeilen)
