import os
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True

FAELLE = [
    # (Dateiinhalt, erwartete Ausgabe)
    (
        "Hund und Katze. Katze, der Hund! HUND? Die katze schläft; der Hund bellt.\n"
        "Für den Müller ist die Katze ein Freund, für den Müller ist der Wald ein Gast.\n"
        "Der Mond scheint, der Wald schweigt, und für die Nacht wird für alle still.\n",
        "der: 5\nfür: 4\nhund: 4",
    ),
    ("b a b a c c d", "a: 2\nb: 2\nc: 2"),
    ("Eins eins. EINS", "eins: 3"),
]


def fail(msg):
    s = " ".join(str(msg).split())[:200].encode("ascii", "backslashreplace").decode("ascii")
    print("FAIL: " + s)
    sys.exit(1)


def main():
    cwd = os.getcwd()
    skript = os.path.join(cwd, "wortzaehler.py")
    if not os.path.isfile(skript):
        fail("wortzaehler.py fehlt")

    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONDONTWRITEBYTECODE"] = "1"

    for nr, (inhalt, erwartet) in enumerate(FAELLE, 1):
        fd, tmp = tempfile.mkstemp(suffix=".txt", prefix="wz_check_")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(inhalt.encode("utf-8"))
            r = subprocess.run(
                [sys.executable, skript, tmp],
                cwd=cwd,
                capture_output=True,
                timeout=8,
                env=env,
            )
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        if r.returncode != 0:
            err = r.stderr.decode("utf-8", "replace").strip().splitlines()
            fail(f"Fall {nr}: Exit-Code {r.returncode} {err[-1] if err else ''}")
        out = r.stdout.decode("utf-8", "replace").replace("\r\n", "\n").rstrip()
        if out != erwartet:
            fail(f"Fall {nr}: Ausgabe {out!r}, erwartet {erwartet!r}")
    print("OK")


try:
    main()
except SystemExit:
    raise
except Exception as e:
    fail(f"{type(e).__name__}: {e}")
