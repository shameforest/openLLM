// Standalone checks for the pure RAG helpers (chunking, cosine, top-k, signature) — no model, no network. Run with
// `node companion/rag-test.mjs`. The embedding call + end-to-end search are proven separately against a live Ollama.
import { chunkText, cosine, topK, indexSig } from './rag.mjs'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('ok: ' + name) } else { fail++; console.log('FAIL: ' + name) } }

// chunkText
ok(chunkText('').length === 0, 'chunkText: empty → no chunks')
ok(chunkText('kurz').length === 1 && chunkText('kurz')[0] === 'kurz', 'chunkText: short text → one chunk')
const long = Array.from({ length: 5000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('')
const cs = chunkText(long, 1600, 200)
ok(cs.length >= 3, 'chunkText: long text → several chunks')
ok(cs.every((c) => c.length <= 1600), 'chunkText: no chunk exceeds the window')
ok(cs[0].slice(-200) === cs[1].slice(0, 200), 'chunkText: consecutive chunks overlap by `overlap` chars')

// cosine
ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9, 'cosine: identical → 1')
ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-9, 'cosine: orthogonal → 0')
ok(cosine([1, 0], []) === 0 && cosine([], []) === 0, 'cosine: empty vector → 0')
ok(cosine([1, 1], [2, 2]) > 0.999, 'cosine: parallel → ~1 regardless of magnitude')

// topK
ok(JSON.stringify(topK([0.1, 0.9, 0.5, 0.3], 2)) === JSON.stringify([1, 2]), 'topK: best indices, best first')
ok(topK([0.1, 0.2], 5).length === 2, 'topK: k larger than list → all')
ok(topK([0.1], 0).length === 0, 'topK: k=0 → none')

// indexSig
ok(indexSig([{ id: 'a', chars: 10 }, { id: 'b', chars: 20 }]) === indexSig([{ id: 'b', chars: 20 }, { id: 'a', chars: 10 }]), 'indexSig: order-independent')
ok(indexSig([{ id: 'a', chars: 10 }]) !== indexSig([{ id: 'a', chars: 11 }]), 'indexSig: changes when an item size changes')
ok(indexSig([]) === '', 'indexSig: empty → empty')

console.log(fail === 0 ? `\nall RAG checks passed (${pass})` : `\n${fail} RAG checks FAILED`)
process.exit(fail === 0 ? 0 : 1)
