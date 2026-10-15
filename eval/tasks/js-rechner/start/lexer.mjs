// Zerlegt einen Ausdruck in Token.
//
// Token:
//   { typ: 'zahl', wert: <number> }
//   { typ: 'op', wert: '+' | '-' | '*' | '/' }
//   { typ: 'klammer', wert: '(' | ')' }

const OPERATOREN = '+-*/';

export function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < text.length && ((text[j] >= '0' && text[j] <= '9') || text[j] === '.')) j++;
      tokens.push({ typ: 'zahl', wert: Number(text.slice(i, j)) });
      i = j;
      continue;
    }
    if (OPERATOREN.includes(c)) {
      tokens.push({ typ: 'op', wert: c });
      i++;
      continue;
    }
    if (c === '(' || c === ')') {
      tokens.push({ typ: 'klammer', wert: c });
      i++;
      continue;
    }
    throw new Error('Unerwartetes Zeichen ' + c);
  }
  return tokens;
}
