import assert from 'node:assert/strict';
import { summe } from './summe.mjs';

assert.equal(summe([1, 2, 3]), 6);
assert.equal(summe([]), 0);
assert.equal(summe([1.5, 2.5]), 4);
assert.equal(summe(['1', 2, '3']), 6);
assert.equal(summe([1, 'abc', 2]), 3);
assert.equal(summe(['x', 'y']), 0);

console.log('alle Tests bestanden');
