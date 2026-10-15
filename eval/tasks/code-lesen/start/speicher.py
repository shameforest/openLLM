"""Speicher-Schicht der Mini-Lagerverwaltung."""

_zustand = {"artikel": {}, "log": []}


def artikel():
    """Gibt das Dictionary mit allen Artikeln zurück (Name -> Menge)."""
    return _zustand["artikel"]


def speichere():
    """Schreibt den kompletten Zustand weg (hier nur simuliert)."""
    return len(_zustand["artikel"])


def speichere_log(zeile):
    """Hängt eine Zeile an das Protokoll an."""
    _zustand["log"].append(zeile)
    return len(_zustand["log"])


def speicher_info():
    """Anzahl der Artikel und der Protokollzeilen."""
    return len(_zustand["artikel"]), len(_zustand["log"])
