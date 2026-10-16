// Direct calls to the local model server (Ollama, port 11434; it allows requests from 127.0.0.1 pages).

export const OLLAMA = 'http://127.0.0.1:11434'

/** Names of the models Ollama holds in the graphics card right now. */
export async function loadedModels(): Promise<string[]> {
  const r = await fetch(`${OLLAMA}/api/ps`)
  const j = await r.json()
  return Array.isArray(j.models) ? j.models.flatMap((m: { name?: string; model?: string }) => [m.name, m.model].filter(Boolean) as string[]) : []
}

/** Keep the model loaded for `minutes` after the last answer (OD-15). Ollama unloads an idle model after 5 minutes;
 *  reloading costs ~10 s plus reading the whole instruction block again without its cache (measured 37 s for the first
 *  step). A request with only `keep_alive` and no prompt just moves the unload time; it does not touch the cache.
 *  Only called right after an answer, when the model is loaded anyway; 0 = leave Ollama's default. */
export async function keepWarm(model: string, minutes: number): Promise<void> {
  if (!model || !(minutes > 0)) return
  try {
    if (!(await loadedModels()).some((n) => n.toLowerCase() === model.toLowerCase())) return // never load it just for this
    await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model, keep_alive: `${Math.round(minutes)}m` }) })
  } catch { /* Ollama not reachable: nothing to keep */ }
}

/** Is this model resident in the GPU right now? */
export async function isLoaded(model: string): Promise<boolean> {
  try { return (await loadedModels()).some((n) => n.toLowerCase() === model.toLowerCase()) } catch { return false }
}

/** Load the model into the GPU now (an empty generate request is Ollama's documented preload) and keep it warm for
 *  `minutes`. Resolves once the model is resident — so the caller can show a progress bar while it is pending. */
export async function preload(model: string, minutes: number): Promise<void> {
  if (!model) return
  const ka = minutes > 0 ? `${Math.round(minutes)}m` : '5m'
  const r = await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model, keep_alive: ka }) })
  // A failed load (e.g. 500 "unable to allocate CUDA0 buffer" when the graphics memory is taken) must not count as a
  // load time for the progress estimate.
  if (!r.ok) throw new Error(`Ollama ${r.status}`)
}

// Remember recent load durations (ms) so the progress bar can estimate; keep the last 10.
const LOAD_KEY = 'openllm.loadms'
export function recordLoadMs(ms: number): void {
  if (!(ms > 0) || ms > 10 * 60_000) return
  try { const a = JSON.parse(localStorage.getItem(LOAD_KEY) || '[]'); a.push(Math.round(ms)); localStorage.setItem(LOAD_KEY, JSON.stringify(a.slice(-10))) } catch { /* private mode */ }
}
/** Median of recent load durations; defaults to 30 s (measured range 10–45 s for the 27B model) when nothing is known. */
export function estLoadMs(): number {
  try {
    const a = (JSON.parse(localStorage.getItem(LOAD_KEY) || '[]') as number[]).filter((x) => x > 0).sort((x, y) => x - y)
    if (a.length) return a[Math.floor(a.length / 2)]
  } catch { /* private mode */ }
  return 30_000
}
/** A setup-style percentage (1–99) from elapsed vs. the estimate; it never hits 100 until the load actually finishes. */
export function loadPct(elapsedMs: number, estMs: number): number {
  const est = estMs > 0 ? estMs : 30_000
  return Math.min(99, Math.max(1, Math.round((elapsedMs / est) * 100)))
}
