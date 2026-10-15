import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// SHA-256 der Original-test.mjs (Zeilenenden auf LF normalisiert)
const TEST_SHA256 = '23665c460b986fd66440eb8df22d00181f79ad161f55c816823bee20ea3db8b5';

function fail(msg) {
  const s = String(msg).replace(/\s+/g, ' ').slice(0, 200)
    .replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  console.log('FAIL: ' + s);
  process.exit(1);
}

const zeige = (x) => (typeof x === 'string' ? JSON.stringify(x) : String(x));

// ---------------------------------------------------------------------------
// Feste Faelle
// ---------------------------------------------------------------------------
const GUELTIG = [
  // Grundrechenarten, Punkt vor Strich, Assoziativitaet
  ['1+2', 3], ['  2 +  3  ', 5], ['2+3*4', 14], ['2*3+4', 10], ['10-4-3', 3], ['10-2-3', 5],
  ['100/10/5', 2], ['8/4/2', 1], ['6/3*2', 4], ['2+6/3', 4], ['6/3+2', 4], ['7-6/3*2', 3],
  ['2*3/4', 1.5], ['1.5*4', 6], ['0.1+0.2', 0.1 + 0.2], ['3.14*2', 3.14 * 2], ['0.5', 0.5],
  ['1/4', 0.25], ['1/3', 1 / 3], ['10/4', 2.5], ['0/5', 0], ['12', 12], ['2-3', -1], ['1+2+3+4', 10],
  ['2*3*4', 24], ['100-10*5-2*3', 44],
  // Klammern
  ['(2+3)*4', 20], ['2*(3+4)*5', 70], ['((1+2)*(3+4))', 21], ['((7))', 7], ['(((((1)))))', 1],
  ['2*(3+(4-1)*2)', 18], ['(1+2)*(3+4)-(5-6)', 22], ['10-(2-3)', 11], ['10-(2+3)', 5], ['100/(10/5)', 50],
  ['((2+3)*(4-1))/5', 3],
  // Potenz (rechtsassoziativ, staerkster Vorrang)
  ['2^3', 8], ['2^3^2', 512], ['(2^3)^2', 64], ['2^0', 1], ['4^0.5', 2], ['2^10', 1024], ['2*3^2', 18],
  ['2^3*2', 16], ['3^2^2', 81], ['2^2^3', 256], ['10^-2', Math.pow(10, -2)], ['2^0.5', Math.pow(2, 0.5)],
  ['1^100', 1], ['2^3+1', 9], ['1+2^3', 9], ['2*3^2+1', 19], ['12/2^2', 3], ['(1+1)^(1+2)', 8],
  ['2^(3^2)', 512], ['2^3^2^1', 512],
  // Unaeres Minus
  ['-5', -5], ['-5+2', -3], ['3*-2', -6], ['2--3', 5], ['2+-3', -1], ['--3', 3], ['---3', -3],
  ['-(2+3)', -5], ['-(-(2))', 2], ['(-2)^2', 4], ['-2^2', -4], ['2^-2', 0.25], ['-2^-2', -0.25],
  ['2^-1^2', 0.5], ['-2*-3', 6], ['4/-2', -2], ['-4/2', -2], ['-2^3^2', -512], ['(-2)^3', -8],
  ['-3^2+10', 1], ['2*-3^2', -18], ['-(3)^2', -9], ['2 - -2', 4], ['1-(-1)', 2], ['(((-1)))', -1],
  ['-1-1', -2], ['-1*-1*-1', -1], ['(-3)*(-3)', 9], ['-(2^2)', -4], ['-(2)^2', -4], ['2^-(1+1)', 0.25],
  // Leerraum
  ['\t1\n+\r\n2', 3], ['  ( 1 + 2 )  *  3  ', 9], [' 7 ', 7], ['2\t^\t3', 8], ['1 +\n\n 1', 2],
];

const DIV0 = ['1/0', '5/(3-3)', '0/0', '1/(2-2)', '1/0*5', '2+1/0', '(1+1)/(1-1)', '3/(2-2)^2', '2^(1/0)'];

const UNGUELTIG = [
  '', ' ', '\t\n', '2 +', '+ 2', '+2', '* 3', '2 * * 3', '2 ** 3', '2 3', '2 (3)', '(2)(3)', '(2)3',
  '(2 + 3', '2 + 3)', '()', '(', ')', '((2)', '2)(', ')2(', '2 $ 3', 'abc', '2a', 'a2', '1e3', '1,5',
  '.5', '5.', '1.2.3', '1..2', '2 + + 3', '2 - + 3', '^2', '2^', '2^^3', '2 ^ * 3', '-', '--', '2-',
  '(-)', '(2+)', '(*2)', '2 +* 3', '1 2 3', '2 3 +', '1 / ', '/ 1', ' - ', '2 = 2', '2 % 3', '2 x 3',
  '2!', '(2+3))', '((2+3)', '1 + (2 * )', '3 -- ', '- - ', '2 ^ ( ', 'NaN', 'Infinity', '0x10', '1_000',
];

const KEIN_STRING = [null, undefined, 42, {}, [], true];

function istSyntaxfehler(e) {
  return e instanceof Error && typeof e.message === 'string' && e.message.startsWith('Syntaxfehler');
}

// ---------------------------------------------------------------------------
// Zufallsausdruecke gegen ein unabhaengiges Referenzmodell
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZAHLEN = ['0', '1', '2', '3', '4', '5', '7', '9', '10', '12', '20', '0.5', '2.5', '0.25', '3.75', '1.5'];

function gen(rnd, tiefe) {
  const r = rnd();
  if (tiefe <= 0 || r < 0.22) return { t: 'num', v: ZAHLEN[Math.floor(rnd() * ZAHLEN.length)] };
  if (r < 0.40) return { t: 'neg', a: gen(rnd, tiefe - 1) };
  const ops = ['+', '-', '*', '/', '^', '+', '-', '*'];
  const op = ops[Math.floor(rnd() * ops.length)];
  const rechts = op === '^' ? gen(rnd, Math.min(tiefe - 1, 1)) : gen(rnd, tiefe - 1);
  return { t: 'bin', op, l: gen(rnd, tiefe - 1), r: rechts };
}

// Ebenen: 1 = + -, 2 = * /, 3 = unaeres Minus, 4 = ^, 5 = Atom
function ebene(n) {
  if (n.t === 'num') return 5;
  if (n.t === 'neg') return 3;
  if (n.op === '+' || n.op === '-') return 1;
  if (n.op === '*' || n.op === '/') return 2;
  return 4;
}

function drucke(n, rnd) {
  const kind = (c, minEbene) => {
    let s = drucke(c, rnd);
    if (ebene(c) < minEbene || rnd() < 0.12) s = '(' + s + ')';
    return s;
  };
  if (n.t === 'num') return n.v;
  if (n.t === 'neg') return '-' + kind(n.a, 3);
  if (n.op === '^') return kind(n.l, 5) + '^' + kind(n.r, 3);
  if (n.op === '*' || n.op === '/') return kind(n.l, 2) + n.op + kind(n.r, 3);
  return kind(n.l, 1) + n.op + kind(n.r, 2);
}

class Unbrauchbar extends Error {}

function ref(n) {
  let w;
  if (n.t === 'num') w = Number(n.v);
  else if (n.t === 'neg') w = -ref(n.a);
  else {
    const l = ref(n.l);
    const r = ref(n.r);
    if (n.op === '+') w = l + r;
    else if (n.op === '-') w = l - r;
    else if (n.op === '*') w = l * r;
    else if (n.op === '/') {
      if (r === 0) throw new Error('Division durch Null');
      w = l / r;
    } else w = Math.pow(l, r);
  }
  if (!Number.isFinite(w) || Math.abs(w) > 1e12) throw new Unbrauchbar();
  return w;
}

function leerraum(s, rnd) {
  const sp = () => ['', '', ' ', '  ', '\t'][Math.floor(rnd() * 5)];
  return sp() + s.replace(/([+\-*/^()])/g, (m) => sp() + m + sp()) + sp();
}

// ---------------------------------------------------------------------------
try {
  const cwd = process.cwd();
  const testPfad = path.join(cwd, 'test.mjs');
  if (!fs.existsSync(testPfad)) fail('test.mjs fehlt');
  const norm = fs.readFileSync(testPfad, 'utf8').replace(/\r\n/g, '\n');
  const hash = crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
  if (hash !== TEST_SHA256) fail('test.mjs wurde veraendert');

  const indexPfad = path.join(cwd, 'index.mjs');
  if (!fs.existsSync(indexPfad)) fail('index.mjs fehlt');
  const mod = await import(pathToFileURL(indexPfad).href);
  if (typeof mod.berechne !== 'function') fail('index.mjs exportiert keine Funktion berechne');
  const berechne = mod.berechne;

  for (const [ausdruck, erwartet] of GUELTIG) {
    let got;
    try {
      got = berechne(ausdruck);
    } catch (e) {
      fail(`berechne(${zeige(ausdruck)}) wirft ${e && e.name}: ${e && e.message}`);
    }
    if (typeof got !== 'number' || got !== erwartet) {
      fail(`berechne(${zeige(ausdruck)}) = ${String(got)}, erwartet ${erwartet}`);
    }
  }

  for (const ausdruck of DIV0) {
    try {
      const got = berechne(ausdruck);
      fail(`berechne(${zeige(ausdruck)}) = ${String(got)}, erwartet Fehler Division durch Null`);
    } catch (e) {
      if (!(e instanceof Error) || e.message !== 'Division durch Null') {
        fail(`berechne(${zeige(ausdruck)}) wirft ${e && e.name}: ${e && e.message}, erwartet Division durch Null`);
      }
    }
  }

  for (const ausdruck of [...UNGUELTIG, ...KEIN_STRING]) {
    let got;
    let geworfen = false;
    try {
      got = berechne(ausdruck);
    } catch (e) {
      geworfen = true;
      if (!istSyntaxfehler(e)) {
        fail(`berechne(${zeige(ausdruck)}) wirft ${e && e.name}: ${e && e.message}, erwartet Syntaxfehler`);
      }
    }
    if (!geworfen) fail(`berechne(${zeige(ausdruck)}) = ${String(got)}, erwartet Syntaxfehler`);
  }

  // Zufallsausdruecke (fester Seed, deterministisch)
  const rnd = mulberry32(20250611);
  let geprueft = 0;
  let div0 = 0;
  for (let versuch = 0; versuch < 3000 && geprueft < 400; versuch++) {
    const baum = gen(rnd, 4);
    let soll;
    let erwartetDiv0 = false;
    try {
      soll = ref(baum);
    } catch (e) {
      if (e instanceof Unbrauchbar) continue;
      erwartetDiv0 = true;
    }
    const ausdruck = leerraum(drucke(baum, rnd), rnd);
    if (erwartetDiv0) {
      if (div0 >= 25) continue;
      div0++;
      try {
        const got = berechne(ausdruck);
        fail(`berechne(${zeige(ausdruck)}) = ${String(got)}, erwartet Fehler Division durch Null`);
      } catch (e) {
        if (!(e instanceof Error) || e.message !== 'Division durch Null') {
          fail(`berechne(${zeige(ausdruck)}) wirft ${e && e.name}: ${e && e.message}, erwartet Division durch Null`);
        }
      }
    } else {
      let got;
      try {
        got = berechne(ausdruck);
      } catch (e) {
        fail(`berechne(${zeige(ausdruck)}) wirft ${e && e.name}: ${e && e.message}`);
      }
      if (typeof got !== 'number' || got !== soll) {
        fail(`berechne(${zeige(ausdruck)}) = ${String(got)}, erwartet ${soll}`);
      }
    }
    geprueft++;
  }
  if (geprueft < 300) fail('interner Fehler: zu wenige Zufallsfaelle');

  const r = spawnSync(process.execPath, ['test.mjs'], { cwd, encoding: 'utf8', timeout: 8000 });
  if (r.status !== 0) fail('node test.mjs schlaegt fehl');
  console.log('OK');
} catch (e) {
  fail(`${e && e.name}: ${e && e.message}`);
}
