import { create } from 'zustand'
import { COMPANION, companionPost } from './companion'

// Cloned GitHub projects (managed by the companion under ~/OpenDante-Projekte). The Einstellungen panel clones/lists
// them and lets you set one as the agent's working folder, plus simple commit/push.
export interface RepoInfo { name: string; path: string }

interface ProjectsState {
  list: RepoInfo[]
  loaded: boolean
  refresh: () => Promise<boolean>
}

export const useProjects = create<ProjectsState>((set) => ({
  list: [],
  loaded: false,
  refresh: async () => {
    try {
      const r = await fetch(COMPANION + '/repos', { signal: AbortSignal.timeout(3000) })
      if (!r.ok) throw new Error(String(r.status))
      const body = (await r.json()) as unknown
      if (!Array.isArray(body)) throw new Error('not a list') // an old companion returns the SPA HTML here
      set({ list: body as RepoInfo[], loaded: true })
      return true
    } catch {
      set({ loaded: true })
      return false
    }
  },
}))

export interface CloneResult { ok: boolean; name: string; path: string; updated: boolean; out?: string; err?: string }
export const cloneRepo = (url: string) => companionPost<CloneResult>('/repo/clone', { url })

export interface GitResult { code: number; out: string; err: string }
export const gitAction = (path: string, action: 'status' | 'commit' | 'push' | 'pull', message?: string) =>
  companionPost<GitResult>('/git', { path, action, message })
