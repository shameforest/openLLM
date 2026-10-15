"""Lager: Artikel anlegen, entnehmen und den Bestand prüfen."""

import speicher


def lege_an(name, menge):
    """Legt einen Artikel an und protokolliert das."""
    speicher.artikel()[name] = menge
    speicher.speichere_log(f"angelegt: {name}")


def entnehme(name, menge):
    """Entnimmt eine Menge und protokolliert das."""
    speicher.artikel()[name] -= menge
    speicher.speichere_log(f"entnommen: {name} x{menge}")


def pruefe_bestand(name, minimum):
    """Prüft, ob genug von einem Artikel da ist. Bei Mangel wird der Zustand gesichert."""
    vorhanden = speicher.artikel().get(name, 0)
    if vorhanden < minimum:
        speicher.speichere()
        return False
    return True
