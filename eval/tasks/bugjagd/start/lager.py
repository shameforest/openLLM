"""Lagerbestand und Reservierungen."""


class NichtVorraetig(Exception):
    """Der verfügbare Bestand reicht für eine Position nicht aus."""

    def __init__(self, nr, gewuenscht, verfuegbar):
        super().__init__(f"Artikel {nr}: gewünscht {gewuenscht}, verfügbar {verfuegbar}")
        self.nr = nr
        self.gewuenscht = gewuenscht
        self.verfuegbar = verfuegbar


class Lager:
    """Bestand je Artikelnummer plus Reservierungen für offene Bestellungen.

    Verfügbar ist, was im Bestand liegt und noch nicht reserviert wurde.
    """

    def __init__(self, bestand=None):
        self._bestand = dict(bestand or {})
        self._reserviert = {}

    def bestand(self, nr):
        return self._bestand.get(nr, 0)

    def reserviert(self, nr):
        return self._reserviert.get(nr, 0)

    def verfuegbar(self, nr):
        return self.bestand(nr) - self.reserviert(nr)

    def wareneingang(self, nr, menge):
        """Bucht gelieferte Ware in den Bestand ein."""
        if menge < 1:
            raise ValueError("Menge muss mindestens 1 sein")
        self._bestand[nr] = self.bestand(nr) + menge

    def reservieren(self, positionen):
        """Reserviert alle Positionen einer Bestellung ganz oder gar nicht.

        Reicht der verfügbare Bestand für einen Artikel nicht aus, wird
        NichtVorraetig ausgelöst und es bleibt nichts reserviert.
        Derselbe Artikel darf in mehreren Positionen einer Bestellung vorkommen.
        """
        for pos in positionen:
            frei = self.verfuegbar(pos.artikel.nr)
            if pos.menge > frei:
                raise NichtVorraetig(pos.artikel.nr, pos.menge, frei)
        for pos in positionen:
            nr = pos.artikel.nr
            self._reserviert[nr] = self.reserviert(nr) + pos.menge

    def freigeben(self, positionen):
        """Hebt die Reservierung der Positionen wieder auf (Bestellung storniert)."""
        for pos in positionen:
            nr = pos.artikel.nr
            self._reserviert[nr] = max(0, self.reserviert(nr) - pos.menge)

    def ausliefern(self, positionen):
        """Bucht reservierte Ware aus dem Bestand aus (Bestellung versendet)."""
        for pos in positionen:
            nr = pos.artikel.nr
            self._bestand[nr] = self.bestand(nr) - pos.menge
            self._reserviert[nr] = max(0, self.reserviert(nr) - pos.menge)
