"""Ausgabe: deutsche Zahlenformate und die Texttabelle."""

KOPF = ("Monat", "Verkäufe", "Menge", "Umsatz (EUR)")


def ganzzahl(n):
    """1234 -> '1.234'"""
    return f"{n:,}".replace(",", ".")


def euro(betrag):
    """Decimal-Betrag mit deutschem Format: Decimal('1234.5') -> '1.234,50'."""
    text = f"{betrag:,.2f}"
    return text.replace(",", "#").replace(".", ",").replace("#", ".")


def _zeile(zellen, breiten):
    erste = zellen[0].ljust(breiten[0])
    rest = [z.rjust(b) for z, b in zip(zellen[1:], breiten[1:])]
    return "  ".join([erste] + rest)


def tabelle(zeilen):
    """Baut die Monatstabelle als Text (ohne abschließenden Zeilenumbruch).

    zeilen ist eine Liste von Tupeln (monat, anzahl, menge, umsatz).
    Die Spaltenbreiten richten sich nach dem breitesten Inhalt der Spalte
    (Kopf und Summenzeile eingeschlossen). Die erste Spalte steht links,
    alle anderen rechtsbündig.
    """
    zellen = [(m, ganzzahl(a), ganzzahl(n), euro(u)) for m, a, n, u in zeilen]
    summe = (
        "Summe",
        ganzzahl(sum(z[1] for z in zeilen)),
        ganzzahl(sum(z[2] for z in zeilen)),
        euro(sum(z[3] for z in zeilen)),
    )
    alle = [KOPF] + zellen + [summe]
    breiten = [max(len(z[i]) for z in alle) for i in range(4)]
    trenner = "  ".join("-" * b for b in breiten)
    ausgabe = [_zeile(KOPF, breiten), trenner]
    ausgabe += [_zeile(z, breiten) for z in zellen]
    ausgabe += [trenner, _zeile(summe, breiten)]
    return "\n".join(ausgabe)
