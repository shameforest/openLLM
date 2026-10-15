"""Berichte über den Zustand des Lagers."""

import speicher


def bericht():
    """Kurzer Statusbericht als Text."""
    anzahl_artikel, anzahl_zeilen = speicher.speicher_info()
    return f"{anzahl_artikel} Artikel, {anzahl_zeilen} Protokollzeilen"


def bericht_mit_kopf(titel):
    """Bericht mit Überschrift. Die Überschrift landet auch im Protokoll."""
    speicher.speichere_log(f"Bericht: {titel}")
    return f"== {titel} ==\n{bericht()}"


def artikelliste():
    """Alle Artikel als sortierte Liste von (name, menge)."""
    return sorted(speicher.artikel().items())
