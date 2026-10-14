import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Modes (optional, off by default) + the settings entered in the "Einstellungen" panel. Persisted locally.
export interface Modes {
  autopilot: boolean
  offload: boolean
  audit: boolean
}

/** Claude models for the paid API offload — IDs from the claude-api reference (Opus 5.5 is the strongest/default). */
export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'stärkste · ~4 $ / 20 $ pro Mio. Token' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'schnell & günstig · ~2 $ / 10 $' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'am günstigsten · ~0,10 $ / 0,50 $' },
]

interface State extends Modes {
  globalInstructions: string
  apiKey: string
  claudeModel: string
  claudeAuto: boolean // true = automatic (paid API), false = manual (copy/paste)
  workdir: string // the folder on disk the agent reads/edits/runs in ('' = the server's own folder)
  toggle: (k: keyof Modes) => void
  set: (p: Partial<Pick<State, 'globalInstructions' | 'apiKey' | 'claudeModel' | 'claudeAuto' | 'workdir'>>) => void
}

export const useSettings = create<State>()(
  persist(
    (set) => ({
      autopilot: false,
      offload: false,
      audit: false,
      globalInstructions: '',
      apiKey: '',
      claudeModel: 'claude-opus-5-5',
      claudeAuto: false,
      workdir: '',
      toggle: (k) => set((s) => ({ [k]: !s[k] }) as Partial<State>),
      set: (p) => set(p),
    }),
    { name: 'openllm.modes' },
  ),
)

/** Prepended to a prompt when Autopilot is on, so the local model follows the batch-autopilot skill. */
export const AUTOPILOT_PREFIX =
  'Arbeite nach dem Skill "batch-autopilot": in kleinen Etappen, mit FORTSCHRITT.md als Gedächtnis, und führe nach jedem Schritt die Tests aus. '
