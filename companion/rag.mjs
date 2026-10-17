// Local, zero-dependency retrieval over a project's knowledge, so the knowledge may outgrow the local model's context
// window (OD-73, stage 2). Embeddings come from a small model served by Ollama, forced onto the CPU (num_gpu 0) so it
// never evicts the 27B from the GPU. The index is a plain JSON file next to the knowledge; search is brute-force cosine
// similarity — fast enough for a single project's knowledge (a few hundred to a few thousand chunks).

const OLLAMA = (process.env.OLLAMA_HOST && /^https?:\/\//.test(process.env.OLLAMA_HOST)) ? process.env.OLLAMA_HOST : 'http://127.0.0.1:11434'
// Small, Apache-2.0 embedder (checked on ollama.com 2026-10-17). Swap via env for a stronger multilingual one (e.g. bge-m3, MIT).
export const EMBED_MODEL = process.env.OPENDANTE_EMBED_MODEL || 'nomic-embed-text'

/** Split text into overlapping ~chunkChars windows. Char-based and deterministic (pure), so retrieval is unit-testable. */
export function chunkText(text, chunkChars = 1600, overlap = 200) {
  const t = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!t) return []
  if (t.length <= chunkChars) return [t]
  const step = Math.max(1, chunkChars - overlap)
  const chunks = []
  for (let i = 0; i < t.length; i += step) {
    chunks.push(t.slice(i, i + chunkChars))
    if (i + chunkChars >= t.length) break
  }
  return chunks
}

/** Cosine similarity of two vectors (0 when either is empty/zero). Pure. */
export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

/** Indices of the k highest scores, best first. Pure. */
export function topK(scores, k) {
  return scores.map((s, i) => [s, i]).sort((x, y) => y[0] - x[0]).slice(0, Math.max(0, k)).map((p) => p[1])
}

/** A signature of the current knowledge items (id + size), to tell whether a stored index is still current. Pure. */
export const indexSig = (items) => (items || []).map((it) => `${it.id}:${it.chars}`).sort().join('|')

/** Embed one or more texts via Ollama, on the CPU. Throws a clear error when the embedding model is not pulled. */
export async function embed(texts, model = EMBED_MODEL) {
  const input = Array.isArray(texts) ? texts : [texts]
  let r
  try {
    r = await fetch(OLLAMA + '/api/embed', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input, options: { num_gpu: 0 }, keep_alive: '5m' }),
    })
  } catch { throw new Error('Ollama ist nicht erreichbar (für die lokale Suche).') }
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    if (r.status === 404 || /not found|no such model|try pulling/i.test(txt)) throw new Error(`Embedding-Modell "${model}" fehlt. Bitte "ollama pull ${model}" ausführen (Apache-2.0, läuft auf der CPU).`)
    throw new Error(`Embedding fehlgeschlagen (${r.status}).`)
  }
  const j = await r.json()
  const vecs = j.embeddings || (j.embedding ? [j.embedding] : [])
  if (!vecs.length || !Array.isArray(vecs[0])) throw new Error('Embedding lieferte keine Vektoren.')
  return vecs
}

/** Build a fresh index: chunk every item, embed the chunks (in batches), and stamp it with the items' signature.
 *  `items` = [{id, name, chars}]; `readText(id)` returns the item's text. */
export async function buildIndex(items, readText, model = EMBED_MODEL) {
  const chunks = []
  for (const it of items || []) {
    const text = await readText(it.id)
    chunkText(text).forEach((c, idx) => chunks.push({ itemId: it.id, name: it.name, idx, text: c }))
  }
  if (!chunks.length) return { model, dim: 0, sig: indexSig(items), chunks: [] }
  const B = 32
  const vecs = []
  for (let i = 0; i < chunks.length; i += B) vecs.push(...await embed(chunks.slice(i, i + B).map((c) => c.text), model))
  chunks.forEach((c, i) => { c.vec = vecs[i] })
  return { model, dim: (vecs[0] || []).length, sig: indexSig(items), chunks }
}

/** Return the k chunks most relevant to `query` (best first), each with its source item and a rounded score. */
export async function search(index, query, k = 6, model = EMBED_MODEL) {
  if (!index || !Array.isArray(index.chunks) || !index.chunks.length) return []
  const [qv] = await embed([query], model)
  const scores = index.chunks.map((c) => cosine(qv, c.vec || []))
  return topK(scores, k).map((i) => ({ itemId: index.chunks[i].itemId, name: index.chunks[i].name, text: index.chunks[i].text, score: Math.round(scores[i] * 1000) / 1000 }))
}
