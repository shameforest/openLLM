import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// SHA-256 der Original-test.mjs (Zeilenenden auf LF normalisiert)
const TEST_SHA256 = '6edb000149269a13308f66aa7308666b96ca71055aeebbfca6dc4facd6fe40d9';

function fail(msg) {
  const s = String(msg).replace(/\s+/g, ' ').slice(0, 200)
    .replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  console.log('FAIL: ' + s);
  process.exit(1);
}

function pruefe(werte, erwartet, summe, name) {
  let got;
  try {
    got = summe(werte);
  } catch (e) {
    fail(`${name}: wirft ${e && e.name}: ${e && e.message}`);
  }
  if (typeof got !== 'number' || Number.isNaN(got) || got !== erwartet) {
    fail(`${name}: Ergebnis ${String(got)}, erwartet ${erwartet}`);
  }
}

try {
  const cwd = process.cwd();
  const testPfad = path.join(cwd, 'test.mjs');
  if (!fs.existsSync(testPfad)) fail('test.mjs fehlt');
  const norm = fs.readFileSync(testPfad, 'utf8').replace(/\r\n/g, '\n');
  const hash = crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
  if (hash !== TEST_SHA256) fail('test.mjs wurde veraendert');

  const summePfad = path.join(cwd, 'summe.mjs');
  if (!fs.existsSync(summePfad)) fail('summe.mjs fehlt');
  const mod = await import(pathToFileURL(summePfad).href);
  if (typeof mod.summe !== 'function') fail('summe.mjs exportiert keine benannte Funktion summe');
  const summe = mod.summe;

  pruefe([], 0, summe, 'leeres Array');
  pruefe([1, 2, 3], 6, summe, '[1,2,3]');
  pruefe([5], 5, summe, '[5]');
  pruefe(['5'], 5, summe, "['5']");
  pruefe(['10', '20', 30], 60, summe, "['10','20',30]");
  pruefe([' 4.5 ', '-2'], 2.5, summe, "[' 4.5 ','-2']");
  pruefe([1.5, 2.5], 4, summe, '[1.5,2.5]');
  pruefe([-1.5, 1.5], 0, summe, '[-1.5,1.5]');
  pruefe([1, 'abc', 2], 3, summe, "[1,'abc',2]");
  pruefe(['abc', 1, 2], 3, summe, "['abc',1,2]");
  pruefe(['x', 'y'], 0, summe, "['x','y']");
  pruefe(['', '  ', 'abc'], 0, summe, 'leere/Whitespace-Strings');
  pruefe([1, null, 2, undefined, 3], 6, summe, 'null/undefined');
  pruefe([NaN, 4, NaN], 4, summe, 'NaN');
  pruefe([null, undefined, true, false, {}, [3], []], 0, summe, 'Booleans/Objekte/Arrays');
  pruefe([true, 1, false, '2', {}], 3, summe, 'gemischt mit Booleans');
  pruefe(Array.from({ length: 1000 }, () => 1), 1000, summe, '1000 Einsen');

  const naeherung = summe([0.1, 0.2]);
  if (Math.abs(naeherung - 0.3) > 1e-9) fail(`[0.1,0.2] ergibt ${naeherung}`);

  const r = spawnSync(process.execPath, ['test.mjs'], { cwd, encoding: 'utf8', timeout: 8000 });
  if (r.status !== 0) fail('node test.mjs schlaegt fehl');
  console.log('OK');
} catch (e) {
  fail(`${e && e.name}: ${e && e.message}`);
}
