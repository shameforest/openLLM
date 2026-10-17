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
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'Standard · schnell & günstig · 2 $ / 10 $ pro Mio. Token' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'stärkste · 4 $ / 20 $' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'am günstigsten · 0,10 $ / 0,50 $' },
] // prices: Anthropic first-party rates (claude-api reference, cached 2026-10-06); same table in companion/server.mjs

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
  keepWarmMin: number // keep the local model loaded this many minutes after an answer (0 = Ollama's 5-minute default)
  planFirst: boolean // send the next request to the read-only "plan" agent first; "Plan umsetzen" then runs it
  fullAutoAck: boolean // OD-71: the user saw the one-time "Voll-Automatik" risk notice (shown only until acknowledged)
  claudeDailyUsd: number // daily spending cap for the paid Claude modes (0 = no cap)
  // OD-16/OD-29: "schnell" = carry out without thinking (model variant "ohne-denken", reasoning_effort none), plan mode
  // still thinks; "gruendlich" = always think. Measured 2026-10-15, 6 hard Testlauf tasks × 2: without thinking 12/12
  // in 74 min, with thinking 11/12 in 167 min. A new key, so existing setups get the measured default too.
  thinkMode: 'schnell' | 'gruendlich'
  // "Claude-Hilfe" range (slider above the prompt box), both as a share of the combined work measured in tokens.
  // offloadShare = MAXIMUM: how much Claude may take over opportunistically (self-contained benign subtasks the local
  // model marks); 0 = no offloading. The safety gate still decides WHAT may leave the PC; this only caps HOW MUCH.
  // offloadMin = MINIMUM (floor): if the local model contributed almost everything (Claude's actual share stayed below
  // this), OpenDante has Claude improve the finished answer once — so a little Claude value is guaranteed even though the
  // local model rarely offloads on its own. 0 = never force it. Enforced MIN ≤ MAX in the UI.
  offloadShare: number
  offloadMin: number
  toggle: (k: keyof Modes) => void
  set: (p: Partial<Pick<State, 'globalInstructions' | 'apiKey' | 'claudeModel' | 'localModel' | 'workdir' | 'folders' | 'thinkingOpen' | 'keepWarmMin' | 'planFirst' | 'claudeDailyUsd' | 'thinkMode' | 'offloadShare' | 'offloadMin' | 'fullAutoAck'>>) => void
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
      claudeModel: 'claude-sonnet-5-5', // only for a fresh setup; an existing choice is kept
      localModel: DEFAULT_LOCAL_MODEL,
      workdir: '',
      folders: [],
      thinkingOpen: false,
      keepWarmMin: 60,
      planFirst: false,
      fullAutoAck: false,
      claudeDailyUsd: 2,
      thinkMode: 'schnell',
      offloadShare: 0, // MAX: off until the user moves the slider above the prompt box
      offloadMin: 0, // MIN floor: off until set; then Claude improves the result when the local model offloaded too little
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

/** The slider's range: Claude may take over at most half the work, so the local model stays the lead. */
export const OFFLOAD_SHARE_MAX = 0.5

/** Prepended to a prompt when Autopilot is on, so the local model follows the batch-autopilot skill. */
export const AUTOPILOT_PREFIX =
  'Arbeite nach dem Skill "batch-autopilot": in kleinen Etappen, mit FORTSCHRITT.md als Gedächtnis, und führe nach jedem Schritt die Tests aus. '
