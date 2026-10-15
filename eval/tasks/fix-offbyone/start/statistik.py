"""Kleine Statistik-Hilfsfunktionen."""


def mittelwert(zahlen):
    """Arithmetisches Mittel einer nicht leeren Liste."""
    if not zahlen:
        raise ValueError("leere Liste")
    return sum(zahlen) / len(zahlen)


def median(zahlen):
    """Median einer nicht leeren Liste (die Liste muss nicht sortiert sein)."""
    if not zahlen:
        raise ValueError("leere Liste")
    s = sorted(zahlen)
    n = len(s)
    mitte = n // 2
    if n % 2 == 1:
        return s[mitte]
    # gerade Anzahl: Mittel der beiden mittleren Werte
    return (s[mitte] + s[mitte + 1]) / 2
