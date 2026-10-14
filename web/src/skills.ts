import { create } from 'zustand'
import { COMPANION } from './companion'

// The skills installed on disk (listed by the companion from ~/.config/opencode/skills). Shared between the
// Einstellungen panel (upload + list) and the sidebar (click to use). Refreshed after an upload and on start.
export interface SkillInfo { slug: string; name: string; description: string }

interface SkillsState {
  list: SkillInfo[]
  loaded: boolean
  refresh: () => Promise<boolean> // true = the companion answered (reachable), false = not reachable yet
}

export const useSkills = create<SkillsState>((set) => ({
  list: [],
  loaded: false,
  refresh: async () => {
    try {
      const r = await fetch(COMPANION + '/skills', { signal: AbortSignal.timeout(2000) })
      if (!r.ok) throw new Error(String(r.status))
      const body = (await r.json()) as unknown
      if (!Array.isArray(body)) throw new Error('not a list') // an old companion returns the SPA HTML here
      set({ list: body as SkillInfo[], loaded: true })
      return true
    } catch {
      set({ loaded: true }) // companion not running yet — keep whatever we had, stop showing "loading"
      return false
    }
  },
}))

/**
 * If the text starts with `/slug`, turn it into an instruction that tells the local model to use that skill
 * (OpenCode loads a skill when the model calls its `skill` tool; naming it in the prompt is the reliable trigger).
 * Returns the text unchanged when it is not a known skill command.
 */
export function expandSkillCommand(text: string, list: SkillInfo[]): string {
  const m = text.match(/^\/([a-z0-9-]+)\b[ \t]*([\s\S]*)$/i)
  if (!m) return text
  const sk = list.find((s) => s.slug === m[1].toLowerCase())
  if (!sk) return text
  const rest = m[2].trim()
  const head = `Verwende den Skill „${sk.name}" und arbeite genau nach seiner Anleitung.`
  return rest ? `${head}\n\n${rest}` : head
}
