import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import modelList from '../../config/models.json'

// Modes (optional, off by default) + the settings entered in the "Einstellungen" panel. Persisted locally.
export interface Modes {
  autopilot: boolean
  offload: boolean
  audit: boolean
  autoAllow: boolean // answer safe permission prompts automatically, so long tasks don't stall waiting for a click
}

/** Claude models for the paid API offload — IDs from the claude-api reference (Opus 5.5 is the strongest/default). */
export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'stärkste · ~4 $ / 20 $ pro Mio. Token' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'schnell & günstig · ~2 $ / 10 $' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'am günstigsten · ~0,10 $ / 0,50 $' },
]

/** Local models served by Ollama — from config/models.json, the single list shared with the companion, install.ps1
 *  and (checked by models.test.ts) config/opencode.json. Uncensored = "abliterated": the refusal direction removed from
 *  the weights, otherwise the same Qwen3.8 27B (Apache-2.0). */
export const LOCAL_MODELS: { id: string; name: string; note: string }[] = modelList.models
export const DEFAULT_LOCAL_MODEL: string = modelList.default
export const localModelName = (id: string): string => LOCAL_MODELS.find((m) => m.id === id)?.name ?? id

interface State extends Modes {
  globalInstructions: string
  apiKey: string
  claudeModel: string
  localModel: string // Ollama tag of the local model the agent runs on
  workdir: string // the active folder on disk the agent reads/edits/runs in ('' = the server's own folder)
  folders: string[] // saved folders to switch between quickly (absolute paths)
  thinkingOpen: boolean // right-hand "Gedankengang" sidebar shown (true) or folded away (false)
  toggle: (k: keyof Modes) => void
  set: (p: Partial<Pick<State, 'globalInstructions' | 'apiKey' | 'claudeModel' | 'localModel' | 'workdir' | 'folders' | 'thinkingOpen'>>) => void
  addFolders: (paths: string[]) => void // remember folders and make the first one active
  removeFolder: (path: string) => void
}

export const useSettings = create<State>()(
  persist(
    (set) => ({
      autopilot: false,
      offload: false,
      audit: false,
      autoAllow: true, // on by default: without it the first command needing permission freezes the whole task
      globalInstructions: '',
      apiKey: '',
      claudeModel: 'claude-opus-5-5',
      localModel: DEFAULT_LOCAL_MODEL,
      workdir: '',
      folders: [],
      thinkingOpen: false,
      toggle: (k) => set((s) => ({ [k]: !s[k] }) as Partial<State>),
      set: (p) => set(p),
      addFolders: (paths) => set((s) => {
        const clean = paths.map((p) => p.trim()).filter(Boolean)
        if (!clean.length) return {}
        const folders = [...s.folders]
        for (const p of clean) if (!folders.includes(p)) folders.push(p)
        return { folders, workdir: clean[0] } // switching happens in App's workdir effect
      }),
      removeFolder: (path) => set((s) => ({
        folders: s.folders.filter((f) => f !== path),
        workdir: s.workdir === path ? '' : s.workdir, // removing the active folder falls back to the default
      })),
    }),
    { name: 'openllm.modes' },
  ),
)

/** Prepended to a prompt when Autopilot is on, so the local model follows the batch-autopilot skill. */
export const AUTOPILOT_PREFIX =
  'Arbeite nach dem Skill "batch-autopilot": in kleinen Etappen, mit FORTSCHRITT.md als Gedächtnis, und führe nach jedem Schritt die Tests aus. '
