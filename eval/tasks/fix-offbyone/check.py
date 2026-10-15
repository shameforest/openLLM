import hashlib
import os
import subprocess
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.getcwd())

# SHA-256 der Original-test_statistik.py (Zeilenenden auf LF normalisiert)
TEST_SHA256 = "27b580de271c185eb08f713a6ed9b464dc64a555d051dd1782bce4b4f066b931"


def fail(msg):
    s = " ".join(str(msg).split())[:200].encode("ascii", "backslashreplace").decode("ascii")
    print("FAIL: " + s)
    sys.exit(1)


def sha(path):
    with open(path, "rb") as f:
        data = f.read().replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def close(a, b):
    return abs(a - b) < 1e-9


def main():
    cwd = os.getcwd()
    test_path = os.path.join(cwd, "test_statistik.py")
    if not os.path.isfile(test_path):
        fail("test_statistik.py fehlt")
    if sha(test_path) != TEST_SHA256:
        fail("test_statistik.py wurde veraendert")

    import statistik

    mw = [
        ([1, 2, 3], 2),
        ([2, 4], 3),
        ([5], 5),
        ([0.5, 1.5], 1.0),
        ([-1, 1], 0),
        ([1.5, 2.5, 3.5, 4.5], 3.0),
    ]
    for liste, erwartet in mw:
        got = statistik.mittelwert(list(liste))
        if not close(got, erwartet):
            fail(f"mittelwert({liste}) = {got}, erwartet {erwartet}")

    med = [
        ([3, 1, 2], 2),
        ([7], 7),
        ([9, 1, 5, 3, 7], 5),
        ([1, 2, 3, 4], 2.5),
        ([4, 1], 2.5),
        ([10, 2, 8, 4], 6),
        ([5, 3, 1, 4, 2, 6], 3.5),
        ([1.5, 2.5, 3.5, 4.5], 3.0),
        ([2.5, 0.5, 1.5], 1.5),
        ([8, 8, 8, 8], 8),
        ([-5, -1, -3, -2], -2.5),
        ([100, 1], 50.5),
        ([6, 1, 9, 3, 2, 8, 7, 4], 5.0),
    ]
    for liste, erwartet in med:
        original = list(liste)
        got = statistik.median(list(liste))
        if not close(got, erwartet):
            fail(f"median({original}) = {got}, erwartet {erwartet}")

    r = subprocess.run(
        [sys.executable, "-B", "test_statistik.py"],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=8,
    )
    if r.returncode != 0:
        fail("python test_statistik.py schlaegt fehl")
    print("OK")


try:
    main()
except SystemExit:
    raise
except Exception as e:
    fail(f"{type(e).__name__}: {e}")
