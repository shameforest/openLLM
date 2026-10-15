// Wertet einen Syntaxbaum aus (siehe parser.mjs) und gibt eine Zahl zurück.

export function auswerten(knoten) {
  switch (knoten.typ) {
    case 'zahl':
      return knoten.wert;
    case 'bin': {
      const l = auswerten(knoten.links);
      const r = auswerten(knoten.rechts);
      switch (knoten.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          if (r === 0) throw new Error('Division durch Null');
          return l / r;
        default:
          throw new Error('Unbekannter Operator ' + knoten.op);
      }
    }
    default:
      throw new Error('Unbekannter Knoten ' + knoten.typ);
  }
}
