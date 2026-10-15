import assert from 'node:assert/strict';
import { berechne } from './index.mjs';

function syntaxfehler(f) {
  assert.throws(f, (e) => e instanceof Error && e.message.startsWith('Syntaxfehler'));
}

// Grundrechenarten und Punkt vor Strich
assert.equal(berechne('1 + 2'), 3);
assert.equal(berechne('2 + 3 * 4'), 14);
assert.equal(berechne('2 * 3 + 4'), 10);
assert.equal(berechne('10 - 4 - 3'), 3);
assert.equal(berechne('2 + 6 / 3'), 4);
assert.equal(berechne('8 / 4 / 2'), 1);
assert.equal(berechne('6 / 3 * 2'), 4);
assert.equal(berechne('1.5 * 4'), 6);

// Klammern
assert.equal(berechne('(2 + 3) * 4'), 20);
assert.equal(berechne('2 * (3 + 4) * 5'), 70);
assert.equal(berechne('((7))'), 7);

// Potenz
assert.equal(berechne('2 ^ 3'), 8);
assert.equal(berechne('2 ^ 3 ^ 2'), 512);
assert.equal(berechne('2 * 3 ^ 2'), 18);

// Unäres Minus
assert.equal(berechne('-5 + 2'), -3);
assert.equal(berechne('3 * -2'), -6);
assert.equal(berechne('-2 ^ 2'), -4);
assert.equal(berechne('-(1 + 2)'), -3);

// Fehler
syntaxfehler(() => berechne('2 +'));
syntaxfehler(() => berechne('(2 + 3'));
syntaxfehler(() => berechne('2 $ 3'));
syntaxfehler(() => berechne(''));
assert.throws(() => berechne('1 / 0'), /Division durch Null/);

console.log('alle Tests bestanden');
