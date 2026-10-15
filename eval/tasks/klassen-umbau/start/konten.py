"""Kleine Kontenverwaltung (prozedural, der Zustand liegt in Modulvariablen).

Beträge sind ganze Cent (int). Kontonummern beginnen bei 1001 und werden
fortlaufend vergeben. Jede Buchung bekommt eine laufende Buchungsnummer,
die über alle Konten hinweg gezählt wird (beginnend bei 1).
"""

_konten = {}  # Kontonummer -> {"inhaber": str, "saldo": int}
_buchungen = []  # (laufende_nr, kontonummer, text, betrag, saldo_danach)
_naechste_nr = 1001
_buchungszaehler = 0


def _pruefe_betrag(betrag):
    if isinstance(betrag, bool) or not isinstance(betrag, int) or betrag <= 0:
        raise ValueError("Betrag muss eine positive ganze Zahl (Cent) sein")


def _konto(nr):
    try:
        return _konten[nr]
    except KeyError:
        raise KeyError(f"Unbekanntes Konto {nr}") from None


def _buche(nr, text, betrag):
    """Verbucht betrag (negativ bei Abgängen) auf Konto nr und merkt die Buchung."""
    global _buchungszaehler
    konto = _konto(nr)
    konto["saldo"] += betrag
    _buchungszaehler += 1
    _buchungen.append((_buchungszaehler, nr, text, betrag, konto["saldo"]))


def _eur(cent, vorzeichen=False):
    euro, rest = divmod(abs(cent), 100)
    text = f"{euro}.{rest:02d}"
    if cent < 0:
        return "-" + text
    return "+" + text if vorzeichen else text


def eroeffnen(inhaber, startguthaben=0):
    """Eröffnet ein Konto und gibt die neue Kontonummer zurück.

    Bei einem Startguthaben über 0 wird eine Buchung "Eröffnung" angelegt.
    """
    global _naechste_nr
    if not isinstance(inhaber, str) or not inhaber.strip():
        raise ValueError("Inhaber fehlt")
    if isinstance(startguthaben, bool) or not isinstance(startguthaben, int) or startguthaben < 0:
        raise ValueError("Startguthaben darf nicht negativ sein")
    nr = _naechste_nr
    _naechste_nr += 1
    _konten[nr] = {"inhaber": inhaber.strip(), "saldo": 0}
    if startguthaben:
        _buche(nr, "Eröffnung", startguthaben)
    return nr


def einzahlen(nr, betrag):
    """Zahlt betrag ein und gibt den neuen Kontostand zurück."""
    _pruefe_betrag(betrag)
    _konto(nr)
    _buche(nr, "Einzahlung", betrag)
    return _konten[nr]["saldo"]


def abheben(nr, betrag):
    """Hebt betrag ab und gibt den neuen Kontostand zurück.

    Reicht das Guthaben nicht, wird ValueError ausgelöst und nichts gebucht.
    """
    _pruefe_betrag(betrag)
    konto = _konto(nr)
    if konto["saldo"] < betrag:
        raise ValueError(f"Nicht genug Guthaben auf Konto {nr}")
    _buche(nr, "Abhebung", -betrag)
    return konto["saldo"]


def ueberweisen(von_nr, nach_nr, betrag):
    """Überweist betrag von einem Konto auf ein anderes (gibt None zurück).

    Alles wird geprüft, bevor gebucht wird: bei einem Fehler bleiben beide
    Konten und die Buchungsliste unverändert.
    """
    _pruefe_betrag(betrag)
    if von_nr == nach_nr:
        raise ValueError("Quell- und Zielkonto sind gleich")
    quelle = _konto(von_nr)
    _konto(nach_nr)
    if quelle["saldo"] < betrag:
        raise ValueError(f"Nicht genug Guthaben auf Konto {von_nr}")
    _buche(von_nr, f"Überweisung an {nach_nr}", -betrag)
    _buche(nach_nr, f"Überweisung von {von_nr}", betrag)


def kontostand(nr):
    """Aktueller Kontostand in Cent."""
    return _konto(nr)["saldo"]


def auszug(nr):
    """Kontoauszug als Liste von Textzeilen: Kopf, je Buchung eine Zeile, Schlusssaldo."""
    konto = _konto(nr)
    zeilen = [f"Kontoauszug {nr} ({konto['inhaber']})"]
    for lfd, kontonr, text, betrag, saldo in _buchungen:
        if kontonr == nr:
            zeilen.append(f"#{lfd:03d} {text:<22} {_eur(betrag, True):>10} {_eur(saldo):>10}")
    zeilen.append(f"Saldo: {_eur(konto['saldo'])}")
    return zeilen
