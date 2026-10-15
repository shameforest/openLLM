"""Demo: kleine Kontenverwaltung benutzen."""
import konten


def melde(text):
    print("->", text)


def main():
    anna = konten.eroeffnen("Anna Müller", 10000)
    ben = konten.eroeffnen("Ben Özdemir")
    melde(f"Konten: {anna} und {ben}")

    konten.einzahlen(ben, 2550)
    konten.ueberweisen(anna, ben, 3000)
    neuer_stand = konten.abheben(ben, 500)
    melde(f"Stand Ben nach Abhebung: {neuer_stand}")

    for versuch in (
        lambda: konten.abheben(ben, 100000),
        lambda: konten.einzahlen(9999, 100),
        lambda: konten.ueberweisen(anna, anna, 1),
        lambda: konten.einzahlen(anna, 0),
    ):
        try:
            versuch()
        except (ValueError, KeyError) as fehler:
            melde(f"Fehler {type(fehler).__name__}: {fehler.args[0]}")

    melde(f"Stand Anna: {konten.kontostand(anna)}")
    melde(f"Stand Ben: {konten.kontostand(ben)}")
    for zeile in konten.auszug(anna):
        print(zeile)
    for zeile in konten.auszug(ben):
        print(zeile)


if __name__ == "__main__":
    main()
