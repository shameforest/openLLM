"""Lagerverwaltung: Preisberechnung und Lagerwert."""


def berechne_preis(menge, einzelpreis):
    """Gesamtpreis in Cent. Ab 10 Stück gibt es 10 % Rabatt."""
    summe = menge * einzelpreis
    if menge >= 10:
        summe = summe * 9 // 10
    return summe


def lagerwert(bestand):
    """Wert aller Artikel im Lager. bestand ist eine Liste von (menge, einzelpreis)."""
    return sum(berechne_preis(menge, einzelpreis) for menge, einzelpreis in bestand)
