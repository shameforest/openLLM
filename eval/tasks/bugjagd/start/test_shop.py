"""Tests für den Shop (einfache asserts). Aufruf: python test_shop.py"""
from decimal import Decimal

from bestellung import Bestellung
from lager import Lager, NichtVorraetig
from models import Artikel, Kunde, Position
from preise import runde, steuer
from rabatte import anwenden, mengenrabatt_prozent

D = Decimal

STIFT = Artikel("A1", "Stift", D("1.50"), D("0.19"))
HEFT = Artikel("A2", "Heft", D("2.50"), D("0.07"))
BUCH = Artikel("A3", "Buch", D("19.90"), D("0.07"))


def test_runde_kaufmaennisch():
    assert runde(D("0.125")) == D("0.13")
    assert runde(D("2.675")) == D("2.68")
    assert runde(D("1.005")) == D("1.01")
    assert runde(D("0.124")) == D("0.12")
    assert runde(D("10")) == D("10.00")


def test_steuer_auf_zeilenbetrag():
    assert steuer(D("1.50"), D("0.19")) == D("0.29")
    assert steuer(D("2.50"), D("0.07")) == D("0.18")
    assert steuer(D("100.00"), D("0.19")) == D("19.00")


def test_mengenrabatt_staffel():
    assert mengenrabatt_prozent(1) == 0
    assert mengenrabatt_prozent(9) == 0
    assert mengenrabatt_prozent(10) == 5
    assert mengenrabatt_prozent(49) == 5
    assert mengenrabatt_prozent(50) == 10


def test_rabatte_wirken_nacheinander():
    assert anwenden(D("200.00"), 5, False) == D("200.00")
    assert anwenden(D("200.00"), 10, False) == D("190.00")
    assert anwenden(D("200.00"), 10, True) == D("180.50")
    assert anwenden(D("200.00"), 5, True) == D("190.00")


def test_rechnung_einfach():
    b = Bestellung(Kunde("Max"), Lager({"A1": 10, "A2": 10}))
    b.hinzufuegen(STIFT, 1)
    b.hinzufuegen(HEFT, 2)
    r = b.rechnung()
    # Stift: 1,50 + 0,29 Steuer; Hefte: 5,00 + 0,35 Steuer
    assert r["netto"] == D("6.50")
    assert r["steuer"] == D("0.64")
    assert r["brutto"] == D("7.14")
    assert r["zu_zahlen"] == D("7.14")


def test_rechnung_stammkunde():
    b = Bestellung(Kunde("Erika", stammkunde=True), Lager({"A3": 20}))
    b.hinzufuegen(BUCH, 10)
    r = b.rechnung()
    # 199,00 netto -> 5 % Mengenrabatt: 189,05 -> 5 % Stammkundenrabatt: 179,60
    assert r["zeilen"][0]["netto"] == D("179.60")
    assert r["zeilen"][0]["steuer"] == D("12.57")
    assert r["brutto"] == D("192.17")


def test_gutschein_zuletzt():
    b = Bestellung(Kunde("Max"), Lager({"A3": 5}), gutschein=D("10.00"))
    b.hinzufuegen(BUCH, 1)
    r = b.rechnung()
    assert r["brutto"] == D("21.29")
    assert r["gutschein"] == D("10.00")
    assert r["zu_zahlen"] == D("11.29")
    gross = Bestellung(Kunde("Max"), Lager({"A3": 5}), gutschein=D("50.00"))
    gross.hinzufuegen(BUCH, 1)
    r = gross.rechnung()
    assert r["gutschein"] == D("21.29")
    assert r["zu_zahlen"] == D("0.00")


def test_lager_reservieren_und_freigeben():
    lager = Lager({"A1": 5})
    lager.reservieren([Position(STIFT, 3)])
    assert lager.verfuegbar("A1") == 2
    lager.freigeben([Position(STIFT, 3)])
    assert lager.verfuegbar("A1") == 5


def test_lager_zu_wenig_bestand():
    lager = Lager({"A1": 2})
    gefangen = False
    try:
        lager.reservieren([Position(STIFT, 3)])
    except NichtVorraetig:
        gefangen = True
    assert gefangen
    assert lager.verfuegbar("A1") == 2


def test_aufgeben_reserviert_ware():
    lager = Lager({"A1": 5, "A2": 5})
    b = Bestellung(Kunde("Max"), lager)
    b.hinzufuegen(STIFT, 2)
    b.hinzufuegen(HEFT, 1)
    b.aufgeben()
    assert lager.verfuegbar("A1") == 3
    assert lager.verfuegbar("A2") == 4


if __name__ == "__main__":
    for name, funktion in list(globals().items()):
        if name.startswith("test_") and callable(funktion):
            funktion()
    print("alle Tests bestanden")
