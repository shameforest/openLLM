import hashlib
import json
import os
import subprocess
import sys
import tempfile
from decimal import Decimal

sys.dont_write_bytecode = True

# SHA-256 der Original-verkaeufe.csv (Zeilenenden auf LF normalisiert)
CSV_SHA256 = "e5b4512680ace543b544310962464b1f2f89dac1a43a43dfc526c130f597db85"

# Ausgabe des Original-Programms `python umsatz.py` (LF-Zeilenenden, mit abschliessendem Zeilenumbruch)
ORIGINAL_STANDARD = (
    "Monat    Verkäufe  Menge  Umsatz (EUR)\n"
    "-------  --------  -----  ------------\n"
    "2025-01        11    102        106,62\n"
    "2025-02        12    128        243,21\n"
    "2025-03         8     76        247,00\n"
    "2025-04        11     89        352,17\n"
    "2025-05         8     41      1.422,10\n"
    "2025-06        10    149        240,28\n"
    "-------  --------  -----  ------------\n"
    "Summe          60    585      2.611,38\n"
)


def fail(msg):
    s = " ".join(str(msg).split())[:200].encode("ascii", "backslashreplace").decode("ascii")
    print("FAIL: " + s)
    sys.exit(1)


def sha(path):
    with open(path, "rb") as f:
        data = f.read().replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# Unabhaengiges Referenzmodell (ganze Cent, eigener CSV-Leser, eigener Tabellenbau)
# ---------------------------------------------------------------------------
def ref_lesen(text):
    zeilen = []
    for roh in text.lstrip("﻿").splitlines()[1:]:
        if not roh.strip():
            continue
        datum, kat, produkt, menge, preis = roh.split(";")
        tag, monat, jahr = datum.split(".")
        cent = int(preis.replace(".", "").replace(",", ""))
        zeilen.append((f"{jahr}-{monat}", kat, int(menge), int(menge) * cent))
    return zeilen


def ref_gruppen(rows, gruppe, ab):
    summen = {}
    for monat, kat, menge, umsatz_c in rows:
        if ab is not None and monat < ab:
            continue
        key = monat if gruppe == "monat" else kat
        a, m, u = summen.get(key, (0, 0, 0))
        summen[key] = (a + 1, m + menge, u + umsatz_c)
    return [(k, *summen[k]) for k in sorted(summen)]


def euro_c(c):
    vorz = "-" if c < 0 else ""
    c = abs(c)
    return vorz + f"{c // 100:,}".replace(",", ".") + "," + f"{c % 100:02d}"


def ganz(n):
    return f"{n:,}".replace(",", ".")


def ref_text(gruppen, gruppe):
    if not gruppen:
        return "Keine Verkäufe.\n"
    kopf = ("Monat" if gruppe == "monat" else "Kategorie", "Verkäufe", "Menge", "Umsatz (EUR)")
    zellen = [(k, ganz(a), ganz(m), euro_c(u)) for k, a, m, u in gruppen]
    summe = ("Summe", ganz(sum(g[1] for g in gruppen)), ganz(sum(g[2] for g in gruppen)),
             euro_c(sum(g[3] for g in gruppen)))
    alle = [kopf] + zellen + [summe]
    breiten = [max(len(z[i]) for z in alle) for i in range(4)]

    def zeile(z):
        return "  ".join([z[0].ljust(breiten[0])] + [x.rjust(b) for x, b in zip(z[1:], breiten[1:])])

    trenner = "  ".join("-" * b for b in breiten)
    return "\n".join([zeile(kopf), trenner] + [zeile(z) for z in zellen] + [trenner, zeile(summe)]) + "\n"


def ref_json(gruppen, gruppe):
    return {
        "gruppe": gruppe,
        "zeilen": [{"schluessel": k, "verkaeufe": a, "menge": m, "umsatz": u} for k, a, m, u in gruppen],
        "summe": {
            "verkaeufe": sum(g[1] for g in gruppen),
            "menge": sum(g[2] for g in gruppen),
            "umsatz": sum(g[3] for g in gruppen),
        },
    }


# ---------------------------------------------------------------------------
class Lauf:
    def __init__(self, cwd):
        self.cwd = cwd
        self.skript = os.path.join(cwd, "umsatz.py")
        self.env = dict(os.environ)
        self.env["PYTHONIOENCODING"] = "utf-8"
        self.env["PYTHONDONTWRITEBYTECODE"] = "1"

    def starte(self, args):
        try:
            r = subprocess.run(
                [sys.executable, "-B", self.skript] + list(args),
                cwd=self.cwd, capture_output=True, timeout=10, env=self.env,
            )
        except subprocess.TimeoutExpired:
            fail(f"umsatz.py {' '.join(args)} dauert zu lange")
        out = r.stdout.decode("utf-8", "replace").replace("\r\n", "\n")
        err = r.stderr.decode("utf-8", "replace").replace("\r\n", "\n")
        return r.returncode, out, err


def pruefe_zahl(wert, soll_cent, was):
    if isinstance(wert, bool) or not isinstance(wert, (int, Decimal)):
        fail(f"{was}: keine JSON-Zahl ({type(wert).__name__})")
    if Decimal(wert) != Decimal(soll_cent) / 100:
        fail(f"{was}: {wert}, erwartet {Decimal(soll_cent) / 100}")


def pruefe_json(out, gruppen, gruppe, was):
    try:
        doc = json.loads(out, parse_float=Decimal)
    except ValueError:
        fail(f"{was}: Ausgabe ist kein gueltiges JSON: {out[:60]!r}")
    if not isinstance(doc, dict) or set(doc) != {"gruppe", "zeilen", "summe"}:
        fail(f"{was}: Schluessel der Wurzel falsch")
    if doc["gruppe"] != gruppe:
        fail(f"{was}: gruppe = {doc['gruppe']!r}, erwartet {gruppe!r}")
    if not isinstance(doc["zeilen"], list) or len(doc["zeilen"]) != len(gruppen):
        fail(f"{was}: {len(doc['zeilen']) if isinstance(doc['zeilen'], list) else '?'} Zeilen, erwartet {len(gruppen)}")
    for z, (k, a, m, u) in zip(doc["zeilen"], gruppen):
        if not isinstance(z, dict) or set(z) != {"schluessel", "verkaeufe", "menge", "umsatz"}:
            fail(f"{was}: Schluessel einer Zeile falsch")
        if z["schluessel"] != k:
            fail(f"{was}: schluessel {z['schluessel']!r}, erwartet {k!r}")
        for feld, soll in (("verkaeufe", a), ("menge", m)):
            if type(z[feld]) is not int or z[feld] != soll:
                fail(f"{was} {k}: {feld} = {z[feld]!r}, erwartet {soll}")
        pruefe_zahl(z["umsatz"], u, f"{was} {k} umsatz")
    s = doc["summe"]
    if not isinstance(s, dict) or set(s) != {"verkaeufe", "menge", "umsatz"}:
        fail(f"{was}: Schluessel der Summe falsch")
    for feld, soll in (("verkaeufe", sum(g[1] for g in gruppen)), ("menge", sum(g[2] for g in gruppen))):
        if type(s[feld]) is not int or s[feld] != soll:
            fail(f"{was} Summe: {feld} = {s[feld]!r}, erwartet {soll}")
    pruefe_zahl(s["umsatz"], sum(g[3] for g in gruppen), f"{was} Summe umsatz")


def fall(lauf, rows, args, csv_arg, gruppe="monat", fmt="text", ab=None, standard=None):
    was = "umsatz.py " + " ".join(list(args)) if args else "umsatz.py (ohne Argumente)"
    rc, out, err = lauf.starte(args)
    if rc != 0:
        fail(f"{was}: Exit-Code {rc} {err.strip().splitlines()[-1] if err.strip() else ''}")
    gruppen = ref_gruppen(rows, gruppe, ab)
    if fmt == "text":
        soll = standard if standard is not None else ref_text(gruppen, gruppe)
        if out != soll:
            fail(f"{was}: Textausgabe weicht ab: {out[:80]!r} statt {soll[:80]!r}")
    else:
        pruefe_json(out, gruppen, gruppe, was)


def main():
    cwd = os.getcwd()
    csv_pfad = os.path.join(cwd, "verkaeufe.csv")
    if not os.path.isfile(os.path.join(cwd, "umsatz.py")):
        fail("umsatz.py fehlt")
    if not os.path.isfile(csv_pfad):
        fail("verkaeufe.csv fehlt")
    if sha(csv_pfad) != CSV_SHA256:
        fail("verkaeufe.csv wurde veraendert")
    lauf = Lauf(cwd)

    with open(csv_pfad, encoding="utf-8") as f:
        rows = ref_lesen(f.read())

    # --- Standardausgabe muss dem Original entsprechen (hart eingetragen) ---
    for args in ([], ["verkaeufe.csv"], ["--gruppe", "monat", "--format", "text", "verkaeufe.csv"]):
        fall(lauf, rows, args, None, standard=ORIGINAL_STANDARD)
    fall(lauf, rows, ["--ab", "2025-03"], None, ab="2025-03")

    # --- neue Optionen auf verkaeufe.csv ------------------------------------
    fall(lauf, rows, ["--gruppe", "kategorie"], None, gruppe="kategorie")
    fall(lauf, rows, ["--gruppe", "kategorie", "--ab", "2025-04"], None, gruppe="kategorie", ab="2025-04")
    fall(lauf, rows, ["--format", "json"], None, fmt="json")
    fall(lauf, rows, ["--format", "json", "--gruppe", "kategorie"], None, gruppe="kategorie", fmt="json")
    fall(lauf, rows, ["--ab", "2025-05", "--format", "json"], None, fmt="json", ab="2025-05")
    fall(lauf, rows, ["--gruppe", "kategorie", "--format", "json", "--ab", "2025-02", "verkaeufe.csv"], None,
         gruppe="kategorie", fmt="json", ab="2025-02")
    # leere Ergebnisse
    fall(lauf, rows, ["--ab", "2099-01", "--gruppe", "kategorie"], None, gruppe="kategorie", ab="2099-01")
    fall(lauf, rows, ["--ab", "2099-01", "--format", "json", "--gruppe", "kategorie"], None,
         gruppe="kategorie", fmt="json", ab="2099-01")

    # --- zweite, versteckte CSV (BOM, CRLF, Leerzeile, Jahreswechsel) --------
    kategorien = [
        ("Getränke", [("Cola 0,5 l", 129), ("Bier Kasten", 1599), ("Wasser", 59)]),
        ("Süßwaren", [("Fruchtgummi", 199), ("Pralinen", 1249)]),
        ("Zubehör", [("Kabel 2 m", 799), ("Netzteil", 2490), ("Hülle", 1299)]),
        ("Backwaren", [("Laugenbrezel", 85), ("Torte", 2250)]),
        ("Obst & Gemüse", [("Avocado", 119), ("Mango", 249)]),
    ]
    s = 987654321
    zeilen = []
    for i in range(48):
        s = (s * 1103515245 + 12345) % (2**31)
        monat_idx = (s >> 8) % 5          # 2024-11 .. 2025-03
        s = (s * 1103515245 + 12345) % (2**31)
        tag = 1 + (s >> 8) % 28
        s = (s * 1103515245 + 12345) % (2**31)
        kat, prods = kategorien[(s >> 8) % len(kategorien)]
        s = (s * 1103515245 + 12345) % (2**31)
        name, preis_c = prods[(s >> 8) % len(prods)]
        s = (s * 1103515245 + 12345) % (2**31)
        menge = 1 + (s >> 8) % 25
        if i % 11 == 5:
            menge = -menge
        jahr, monat = [(2024, 11), (2024, 12), (2025, 1), (2025, 2), (2025, 3)][monat_idx]
        preis = euro_c(preis_c)
        zeilen.append(f"{tag:02d}.{monat:02d}.{jahr};{kat};{name};{menge};{preis}")
    zeilen.insert(20, "")
    versteckt = "datum;kategorie;produkt;menge;einzelpreis\r\n" + "\r\n".join(zeilen) + "\r\n"
    with tempfile.TemporaryDirectory() as tmp:
        pfad = os.path.join(tmp, "andere_verkaeufe.csv")
        with open(pfad, "wb") as f:
            f.write(b"\xef\xbb\xbf" + versteckt.encode("utf-8"))
        rows2 = ref_lesen(versteckt)
        fall(lauf, rows2, [pfad], None)
        fall(lauf, rows2, [pfad, "--gruppe", "kategorie"], None, gruppe="kategorie")
        fall(lauf, rows2, [pfad, "--format", "json"], None, fmt="json")
        fall(lauf, rows2, [pfad, "--gruppe", "kategorie", "--format", "json"], None, gruppe="kategorie", fmt="json")
        fall(lauf, rows2, ["--gruppe", "kategorie", "--ab", "2025-01", pfad], None, gruppe="kategorie", ab="2025-01")
        fall(lauf, rows2, [pfad, "--gruppe", "kategorie", "--format", "json", "--ab", "2025-03"], None,
             gruppe="kategorie", fmt="json", ab="2025-03")

        # --- Fehlerfaelle: Exit-Code 2, stdout leer, Meldung auf stderr ----------
        fehler = [
            (["nichtda.csv"], "Fehler: Datei nicht gefunden"),
            (["--gruppe", "kategorie", "--format", "json", "nichtda.csv"], "Fehler: Datei nicht gefunden"),
        ]
        kaputt = os.path.join(tmp, "kaputt.csv")
        with open(kaputt, "w", encoding="utf-8", newline="") as f:
            f.write("a;b;c\n1;2;3\n")
        fehler.append(([kaputt, "--format", "json"], "Fehler:"))
        for args, start in fehler:
            rc, out, err = lauf.starte(args)
            if rc != 2:
                fail(f"umsatz.py {' '.join(args)}: Exit-Code {rc}, erwartet 2")
            if out.strip():
                fail(f"umsatz.py {' '.join(args)}: stdout nicht leer bei Fehler")
            if not err.strip().startswith(start):
                fail(f"umsatz.py {' '.join(args)}: stderr {err.strip()[:60]!r}")
        for args in (["--gruppe", "produkt"], ["--format", "xml"]):
            rc, out, err = lauf.starte(args)
            if rc != 2:
                fail(f"umsatz.py {' '.join(args)}: Exit-Code {rc}, erwartet 2")

    print("OK")


try:
    main()
except SystemExit:
    raise
except Exception as e:
    fail(f"{type(e).__name__}: {e}")
