import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from decimal import Decimal
from fractions import Fraction

sys.dont_write_bytecode = True

# SHA-256 der Original-zugriffe.log (Zeilenenden auf LF normalisiert)
LOG_SHA256 = "c096c34a505b0ac1e59a6aa18fee065cf1bd154c87076f733dd634160e7119f6"

ZEILE = re.compile(
    r"([0-9]{4}-[0-9]{2}-[0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) ([A-Z]+) (/[^\s]*) ([0-9]{3}) ([0-9]+)"
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
# Referenzberechnung (exakte Bruchrechnung, kaufmaennisch gerundet)
# ---------------------------------------------------------------------------
def runde_halb_auf(zaehler, nenner, stellen):
    q = Fraction(zaehler, nenner) * 10**stellen
    return Decimal(math.floor(q + Fraction(1, 2))).scaleb(-stellen)


def referenz(text):
    status = {}
    pfade = {}
    summe = {}
    anzahl = {}
    gesamt = 0
    fehler = 0
    for zeile in re.split(r"\r?\n", text):
        m = ZEILE.fullmatch(zeile)
        if not m:
            continue
        gesamt += 1
        code = m.group(7)
        status[code] = status.get(code, 0) + 1
        pfad = m.group(6).split("?", 1)[0]
        pfade[pfad] = pfade.get(pfad, 0) + 1
        h = m.group(2)
        summe[h] = summe.get(h, 0) + int(m.group(8))
        anzahl[h] = anzahl.get(h, 0) + 1
        if int(code) >= 500:
            fehler += 1
    top = sorted(pfade.items(), key=lambda kv: (-kv[1], kv[0]))[:5]
    return {
        "gesamt": gesamt,
        "status": status,
        "top_pfade": [(p, n) for p, n in top],
        "antwortzeit_je_stunde": {h: runde_halb_auf(summe[h], anzahl[h], 1) for h in summe},
        "fehlerrate": runde_halb_auf(fehler, gesamt, 4) if gesamt else Decimal(0),
    }


def ist_zahl(x):
    return isinstance(x, (int, Decimal)) and not isinstance(x, bool)


def vergleiche(pfad_json, soll, was):
    try:
        with open(pfad_json, "rb") as f:
            roh = f.read()
    except OSError:
        fail(f"{was}: bericht.json fehlt")
    if roh.startswith(b"\xef\xbb\xbf"):
        fail(f"{was}: bericht.json hat ein BOM")
    try:
        b = json.loads(roh.decode("utf-8"), parse_float=Decimal)
    except ValueError:
        fail(f"{was}: bericht.json ist kein gueltiges UTF-8-JSON")
    if not isinstance(b, dict) or set(b) != set(soll):
        fail(f"{was}: Schluessel {sorted(b) if isinstance(b, dict) else type(b).__name__}, erwartet {sorted(soll)}")
    if type(b["gesamt"]) is not int or b["gesamt"] != soll["gesamt"]:
        fail(f"{was}: gesamt = {b['gesamt']!r}, erwartet {soll['gesamt']}")
    st = b["status"]
    if not isinstance(st, dict) or set(st) != set(soll["status"]):
        fail(f"{was}: Statuscodes {sorted(st) if isinstance(st, dict) else '?'}, erwartet {sorted(soll['status'])}")
    for code, n in soll["status"].items():
        if type(st[code]) is not int or st[code] != n:
            fail(f"{was}: status {code} = {st[code]!r}, erwartet {n}")
    top = b["top_pfade"]
    if not isinstance(top, list) or len(top) != len(soll["top_pfade"]):
        fail(f"{was}: top_pfade hat {len(top) if isinstance(top, list) else '?'} Eintraege, erwartet {len(soll['top_pfade'])}")
    for i, (eintrag, (p, n)) in enumerate(zip(top, soll["top_pfade"])):
        if not isinstance(eintrag, dict) or set(eintrag) != {"pfad", "anzahl"}:
            fail(f"{was}: top_pfade[{i}] hat falsche Schluessel")
        if eintrag["pfad"] != p or type(eintrag["anzahl"]) is not int or eintrag["anzahl"] != n:
            fail(f"{was}: top_pfade[{i}] = {eintrag['pfad']!r}/{eintrag['anzahl']!r}, erwartet {p!r}/{n}")
    az = b["antwortzeit_je_stunde"]
    if not isinstance(az, dict) or set(az) != set(soll["antwortzeit_je_stunde"]):
        fail(f"{was}: Stunden {sorted(az) if isinstance(az, dict) else '?'}, erwartet {sorted(soll['antwortzeit_je_stunde'])}")
    for h, w in soll["antwortzeit_je_stunde"].items():
        if not ist_zahl(az[h]) or Decimal(az[h]) != w:
            fail(f"{was}: antwortzeit_je_stunde[{h}] = {az[h]!r}, erwartet {w}")
    fr = b["fehlerrate"]
    if not ist_zahl(fr) or Decimal(fr) != soll["fehlerrate"]:
        fail(f"{was}: fehlerrate = {fr!r}, erwartet {soll['fehlerrate']}")


# ---------------------------------------------------------------------------
# Zweites, verstecktes Log (deterministisch erzeugt)
# ---------------------------------------------------------------------------
class Lcg:
    def __init__(self, seed):
        self.s = seed

    def n(self, k):
        self.s = (self.s * 1103515245 + 12345) % (2**31)
        return (self.s >> 8) % k

    def shuffle(self, seq):
        for i in range(len(seq) - 1, 0, -1):
            j = self.n(i + 1)
            seq[i], seq[j] = seq[j], seq[i]


def verstecktes_log():
    r = Lcg(777001)
    pfade = [
        ("/index.html", 20, [""]),
        ("/api/v2/items", 20, ["", "?page=1", "?page=2", "?page=3"]),
        ("/static/app.css", 15, [""]),
        ("/static/app.js", 15, [""]),
        ("/static/logo.png", 15, [""]),
        ("/status", 15, [""]),
        ("/Index.html", 8, [""]),
        ("/login", 12, [""]),
        ("/logout", 10, [""]),
        ("/about", 10, [""]),
        ("/contact", 6, [""]),
        ("/x", 14, [""]),
    ]
    anfragen = []
    for pfad, anzahl, varianten in pfade:
        for _ in range(anzahl):
            anfragen.append(pfad + varianten[r.n(len(varianten))])
    r.shuffle(anfragen)
    # /status soll im Log vor /static/logo.png zuerst vorkommen (Gleichstand darf nicht ueber die Reihenfolge entschieden werden)
    i_status = anfragen.index("/status")
    i_logo = anfragen.index("/static/logo.png")
    if i_logo < i_status:
        anfragen[i_logo], anfragen[i_status] = anfragen[i_status], anfragen[i_logo]
    assert len(anfragen) == 160
    codes = [500, 500, 502, 503, 599] + [404] * 6 + [301] * 4 + [304] * 5 + [403] * 2 + [418]
    codes += [200] * (160 - len(codes))
    r.shuffle(codes)
    # Stunden: Anzahl je Stunde und Rest der Summe (modul) fuer Rundungs-Gleichstaende
    stunden = [(0, 4, 1, 4), (1, 8, 2, 8), (6, 20, 1, 20), (7, 40, 22, 40), (9, 33, 0, 1),
               (13, 25, 0, 1), (14, 16, 4, 16), (20, 10, 0, 1), (23, 4, 3, 4)]
    tage = ["2024-12-30", "2024-12-31", "2025-01-01", "2025-01-02"]
    zeiten = []
    for h, anzahl, _, _ in stunden:
        for _ in range(anzahl):
            zeiten.append((tage[r.n(4)], h, r.n(60), r.n(60)))
    zeiten.sort()
    methoden = ["GET", "GET", "GET", "POST", "HEAD", "PUT", "DELETE"]
    zeilen = []
    for (tag, h, mi, se), pfad, code in zip(zeiten, anfragen, codes):
        zeilen.append([tag, h, mi, se, methoden[r.n(len(methoden))], pfad, code, 5 + r.n(400)])
    for h, anzahl, rest, modul in stunden:
        idx = [i for i, z in enumerate(zeilen) if z[1] == h]
        summe = sum(zeilen[i][7] for i in idx)
        zeilen[idx[-1]][7] += (rest - summe) % modul
    ausgabe = [f"{z[0]} {z[1]:02d}:{z[2]:02d}:{z[3]:02d} {z[4]} {z[5]} {z[6]} {z[7]}" for z in zeilen]
    muell = [
        "", "   ", "garbage line", "2025-01-02 10:00:00 GET /index.html 200",
        "2025-01-02 10:00:00 GET /index.html 200 15 extra", "2025-01-02 10:00:01 get /index.html 200 15",
        "2025-01-02 10:00:02 GET index.html 200 15", "2025-01-02 10:00:03 GET /index.html 2xx 15",
        "2025-01-02 10:00:04 GET /index.html 200 1.5", "2025-01-02 10:00:05 GET /index.html 200 -3",
        "2025-01-02T10:00:06 GET /index.html 200 15", "2025/01/02 10:00:07 GET /index.html 200 15",
        "2025-01-02 10:00 GET /index.html 200 15", "ünd ärger: kaputte Zeile ß",
    ]
    schritt = len(ausgabe) // (len(muell) + 1)
    voll = []
    k = 0
    for i, z in enumerate(ausgabe):
        voll.append(z)
        if k < len(muell) and (i + 1) % schritt == 0:
            voll.append(muell[k])
            k += 1
    voll.extend(muell[k:])
    # Windows-Zeilenenden, letzte Zeile ohne Zeilenumbruch
    return "\r\n".join(voll)


def starte(skript, cwd, args):
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    try:
        r = subprocess.run(
            [sys.executable, "-B", skript] + list(args), cwd=cwd, capture_output=True, timeout=15, env=env
        )
    except subprocess.TimeoutExpired:
        fail("analyse.py dauert zu lange")
    err = r.stderr.decode("utf-8", "replace").strip()
    return r.returncode, err


def main():
    cwd = os.getcwd()
    log_pfad = os.path.join(cwd, "zugriffe.log")
    skript = os.path.join(cwd, "analyse.py")
    if not os.path.isfile(log_pfad):
        fail("zugriffe.log fehlt")
    if sha(log_pfad) != LOG_SHA256:
        fail("zugriffe.log wurde veraendert")
    if not os.path.isfile(skript):
        fail("analyse.py fehlt")
    with open(log_pfad, encoding="utf-8", newline="") as f:
        text = f.read()
    soll = referenz(text)
    if soll["gesamt"] < 1500:
        fail("interner Fehler: zu wenige gueltige Zeilen")

    # 1. von der Aufgabe verlangtes bericht.json im Arbeitsordner
    vergleiche(os.path.join(cwd, "bericht.json"), soll, "bericht.json im Arbeitsordner")

    with tempfile.TemporaryDirectory() as tmp:
        # 2. analyse.py auf dem Original-Log (relativer Pfad, frischer Ordner)
        a = os.path.join(tmp, "a")
        os.mkdir(a)
        shutil.copyfile(log_pfad, os.path.join(a, "zugriffe.log"))
        rc, err = starte(skript, a, ["zugriffe.log"])
        if rc != 0:
            fail(f"analyse.py zugriffe.log: Exit-Code {rc} {err[-80:]}")
        vergleiche(os.path.join(a, "bericht.json"), soll, "analyse.py auf zugriffe.log")

        # 3. zweites, verstecktes Log (CRLF, Muellzeilen, andere Pfade/Daten, Rundungs-Gleichstaende)
        b = os.path.join(tmp, "b")
        os.mkdir(b)
        versteckt = verstecktes_log()
        log_b = os.path.join(tmp, "anderes_log.txt")
        with open(log_b, "wb") as f:
            f.write(versteckt.encode("utf-8"))
        rc, err = starte(skript, b, [log_b])
        if rc != 0:
            fail(f"analyse.py (zweites Log): Exit-Code {rc} {err[-80:]}")
        soll_b = referenz(versteckt)
        if soll_b["gesamt"] != 160 or soll_b["fehlerrate"] != Decimal("0.0313"):
            fail("interner Fehler: verstecktes Log hat unerwartete Werte")
        vergleiche(os.path.join(b, "bericht.json"), soll_b, "analyse.py auf zweitem Log")

        # 4. Log ohne eine gueltige Zeile
        c = os.path.join(tmp, "c")
        os.mkdir(c)
        log_c = os.path.join(tmp, "leer.log")
        with open(log_c, "wb") as f:
            f.write("\n\nnur Müll\n-- nichts --\n".encode("utf-8"))
        rc, err = starte(skript, c, [log_c])
        if rc != 0:
            fail(f"analyse.py (Log ohne gueltige Zeile): Exit-Code {rc} {err[-80:]}")
        vergleiche(os.path.join(c, "bericht.json"), referenz("x"), "analyse.py auf Log ohne gueltige Zeile")

        # 5. fehlende Datei
        d = os.path.join(tmp, "d")
        os.mkdir(d)
        rc, err = starte(skript, d, ["gibtesnicht.log"])
        if rc != 1:
            fail(f"analyse.py gibtesnicht.log: Exit-Code {rc}, erwartet 1")
        if err.splitlines()[-1:] != ["Fehler: Datei nicht gefunden: gibtesnicht.log"]:
            fail(f"analyse.py gibtesnicht.log: stderr {err[-80:]!r}")
        if os.path.exists(os.path.join(d, "bericht.json")):
            fail("analyse.py hat trotz fehlender Datei ein bericht.json angelegt")

    print("OK")


try:
    main()
except SystemExit:
    raise
except Exception as e:
    fail(f"{type(e).__name__}: {e}")
