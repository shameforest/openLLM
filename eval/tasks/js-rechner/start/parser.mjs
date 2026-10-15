// Baut aus den Token einen Syntaxbaum (rekursiver Abstieg).
//
// Grammatik (bisher):
//   ausdruck := term (('+' | '-' | '/') term)*
//   term     := faktor ('*' faktor)*
//   faktor   := zahl | '(' ausdruck ')'
//
// Knoten:
//   { typ: 'zahl', wert }
//   { typ: 'bin', op, links, rechts }

export function parse(tokens) {
  let pos = 0;

  const vorschau = () => tokens[pos];
  const weiter = () => tokens[pos++];
  const istOp = (t, ops) => t !== undefined && t.typ === 'op' && ops.includes(t.wert);

  function ausdruck() {
    let links = term();
    while (istOp(vorschau(), ['+', '-', '/'])) {
      const op = weiter().wert;
      const rechts = term();
      links = { typ: 'bin', op, links, rechts };
    }
    return links;
  }

  function term() {
    let links = faktor();
    while (istOp(vorschau(), ['*'])) {
      const op = weiter().wert;
      const rechts = faktor();
      links = { typ: 'bin', op, links, rechts };
    }
    return links;
  }

  function faktor() {
    const t = weiter();
    if (t === undefined) throw new Error('Unerwartetes Ende');
    if (t.typ === 'zahl') return { typ: 'zahl', wert: t.wert };
    if (t.typ === 'klammer' && t.wert === '(') {
      const inner = ausdruck();
      const zu = weiter();
      if (zu === undefined || zu.typ !== 'klammer' || zu.wert !== ')') {
        throw new Error('Klammer nicht geschlossen');
      }
      return inner;
    }
    throw new Error('Unerwartetes Token ' + t.wert);
  }

  return ausdruck();
}
