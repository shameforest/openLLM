// What this PC learned about step and task durations (for the countdowns). Kept per browser profile.
export const STEPS_KEY = 'openllm.steps'
export const TASKS_KEY = 'openllm.tasks'
export const GIT_SKIP_KEY = 'openllm.nogit.skip' // folders where the "Sicherung einschalten" hint is not shown again
export const loadList = <T,>(key: string): T[] => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
export const saveList = (key: string, v: unknown[]) => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* private mode */ } }
