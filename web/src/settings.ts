import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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

/** Local models served by Ollama. The first one is the default. Keep in sync with config/opencode.json and install.ps1.
 *  Uncensored = "abliterated": the refusal direction removed from the weights, otherwise the same Qwen3.8 27B
 *  (Apache-2.0). Checked 2026-10-15 on ollama.com: orcarouter lists Apache-2.0 + tools + thinking, 18 GB at q4_K_M. */
export const LOCAL_MODELS = [
  { id: 'orcarouter/Qwen3.8-27B-Uncensored:q4_K_M', name: 'Qwen3.8 27B Uncensored', note: 'zensurfrei (abliteriert) · Standard · 18 GB' },
  { id: 'qwen3.8:27b', name: 'Qwen3.8 27B', note: 'Originalfassung von Alibaba · 17 GB' },
  { id: 'huihui_ai/Qwen3.8-abliterated:27b-q4_K_M', name: 'Qwen3.8 27B Abliterated (huihui)', note: 'zensurfreie Alternative · 18 GB' },
]
export const localModelName = (id: string): string => LOCAL_MODELS.find((m) => m.id === id)?.name ?? id

interface State extends Modes {
  globalInstructions: string
  apiKey: string
  claudeModel: string
  localModel: string // Ollama tag of the local model the agent runs on
  workdir: string // the folder on disk the agent reads/edits/runs in ('' = the server's own folder)
  thinkingOpen: boolean // right-hand "Gedankengang" sidebar shown (true) or folded away (false)
  toggle: (k: keyof Modes) => void
  set: (p: Partial<Pick<State, 'globalInstructions' | 'apiKey' | 'claudeModel' | 'localModel' | 'workdir' | 'thinkingOpen'>>) => void
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
      localModel: LOCAL_MODELS[0].id,
      workdir: '',
      thinkingOpen: false,
      toggle: (k) => set((s) => ({ [k]: !s[k] }) as Partial<State>),
      set: (p) => set(p),
    }),
    { name: 'openllm.modes' },
  ),
)

/** Prepended to a prompt when Autopilot is on, so the local model follows the batch-autopilot skill. */
export const AUTOPILOT_PREFIX =
  'Arbeite nach dem Skill "batch-autopilot": in kleinen Etappen, mit FORTSCHRITT.md als Gedächtnis, und führe nach jedem Schritt die Tests aus. '
