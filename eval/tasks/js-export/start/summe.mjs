// Summiert die Werte eines Arrays.
export function summe(werte) {
  return werte.reduce((a, b) => a + Number(b));
}
