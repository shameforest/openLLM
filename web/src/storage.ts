// What this PC learned about step and task durations (for the countdowns). Kept per browser profile.
export const STEPS_KEY = 'openllm.steps'
export const TASKS_KEY = 'openllm.tasks'
export const GIT_SKIP_KEY = 'openllm.nogit.skip' // folders where the "Sicherung einschalten" hint is not shown again
export const ALWAYS_KEY = 'openllm.always' // OD-63: folder → the permission patterns the user chose "Immer erlauben" for
export const loadList = <T,>(key: string): T[] => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
export const saveList = (key: string, v: unknown[]) => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* private mode */ } }

// One standing permission grant: the pattern OpenCode offered for "always" (e.g. "npm *"), the request kind and when it was granted.
export type AlwaysGrant = { pat: string; kind: string; at: number }
// A folder-keyed map (grants are per working folder). Kept per browser profile, like the lists above.
export const loadMap = <T,>(key: string): Record<string, T[]> => { try { const v = JSON.parse(localStorage.getItem(key) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} } }
export const saveMap = (key: string, v: Record<string, unknown[]>) => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* private mode */ } }
