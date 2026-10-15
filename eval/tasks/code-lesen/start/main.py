"""Einstiegspunkt der Mini-Lagerverwaltung."""

import berichte
import lager


def main():
    lager.lege_an("Schraube", 100)
    lager.lege_an("Mutter", 40)
    lager.entnehme("Schraube", 30)
    if not lager.pruefe_bestand("Mutter", 50):
        print("Mutter: Bestand zu niedrig")
    print(berichte.bericht_mit_kopf("Lager"))
    for name, menge in berichte.artikelliste():
        print(f"{name}: {menge}")


if __name__ == "__main__":
    main()
