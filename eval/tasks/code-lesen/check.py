import hashlib
import os
import sys

sys.dont_write_bytecode = True

# SHA-256 der Original-Dateien (Zeilenenden auf LF normalisiert)
HASHES = {
    "speicher.py": "3ee9f059d5f6b711af7a547b1510b87d1b329f12baebae3c9415365ce4c106d6",
    "lager.py": "717c4f7a3b4964ffd5c23f98ada9a2fc82b247d1e354d5e273f99f1e88e8454c",
    "berichte.py": "a6b55a7a82f67c63c10f58b76daad4a08434ca1b266d4bc8923c2c73ff21b891",
    "main.py": "353042aaeda0d7d34a858355e3464d10d47f1ecfc127f5c0075421627a3f4489",
}
ERWARTET = "pruefe_bestand"


def fail(msg):
    s = " ".join(str(msg).split())[:200].encode("ascii", "backslashreplace").decode("ascii")
    print("FAIL: " + s)
    sys.exit(1)


def sha(path):
    with open(path, "rb") as f:
        data = f.read().replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def main():
    cwd = os.getcwd()
    for name, soll in HASHES.items():
        pfad = os.path.join(cwd, name)
        if not os.path.isfile(pfad):
            fail(f"{name} fehlt")
        if sha(pfad) != soll:
            fail(f"{name} wurde veraendert")

    pfad = os.path.join(cwd, "antwort.txt")
    if not os.path.isfile(pfad):
        fail("antwort.txt fehlt")
    with open(pfad, "rb") as f:
        roh = f.read()
    text = roh.decode("utf-8-sig", "replace").strip().strip("`'\" \t\r\n").strip()
    if text != ERWARTET:
        fail(f"Antwort {text[:60]!r}, erwartet {ERWARTET!r}")
    print("OK")


try:
    main()
except SystemExit:
    raise
except Exception as e:
    fail(f"{type(e).__name__}: {e}")
