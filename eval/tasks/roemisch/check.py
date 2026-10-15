import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.getcwd())


def fail(msg):
    s = " ".join(str(msg).split())[:200].encode("ascii", "backslashreplace").decode("ascii")
    print("FAIL: " + s)
    sys.exit(1)


WERTE = [
    (1, "I"), (2, "II"), (3, "III"), (4, "IV"), (5, "V"), (6, "VI"), (8, "VIII"),
    (9, "IX"), (10, "X"), (14, "XIV"), (19, "XIX"), (40, "XL"), (49, "XLIX"),
    (50, "L"), (90, "XC"), (99, "XCIX"), (400, "CD"), (500, "D"), (900, "CM"),
    (1000, "M"), (1994, "MCMXCIV"), (2024, "MMXXIV"), (3888, "MMMDCCCLXXXVIII"),
    (3999, "MMMCMXCIX"),
]


def referenz(n):
    tabelle = [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"),
               (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]
    out = ""
    for wert, sym in tabelle:
        while n >= wert:
            out += sym
            n -= wert
    return out


def main():
    import roemisch

    for n, s in WERTE:
        got = roemisch.zu_roemisch(n)
        if got != s:
            fail(f"zu_roemisch({n}) = {got!r}, erwartet {s!r}")
        back = roemisch.von_roemisch(s)
        if back != n or not isinstance(back, int):
            fail(f"von_roemisch({s!r}) = {back!r}, erwartet {n}")

    for n in range(1, 4000):
        s = roemisch.zu_roemisch(n)
        if not isinstance(s, str) or s != referenz(n):
            fail(f"zu_roemisch({n}) = {s!r}, erwartet {referenz(n)!r}")
        if roemisch.von_roemisch(s) != n:
            fail(f"Round-Trip fehlgeschlagen bei {n}")

    for schlecht in (0, 4000, -1, -5, 10000):
        try:
            roemisch.zu_roemisch(schlecht)
        except ValueError:
            continue
        except Exception as e:
            fail(f"zu_roemisch({schlecht}) wirft {type(e).__name__} statt ValueError")
        fail(f"zu_roemisch({schlecht}) wirft kein ValueError")
    print("OK")


try:
    main()
except SystemExit:
    raise
except Exception as e:
    fail(f"{type(e).__name__}: {e}")
