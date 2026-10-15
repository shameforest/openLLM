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
