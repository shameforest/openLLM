// Öffentliche Schnittstelle: berechne('2 + 3 * 4') ergibt 14.
import { tokenize } from './lexer.mjs';
import { parse } from './parser.mjs';
import { auswerten } from './auswerten.mjs';

export function berechne(ausdruck) {
  const tokens = tokenize(ausdruck);
  const baum = parse(tokens);
  return auswerten(baum);
}
