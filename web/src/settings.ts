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
export interface EffortLevel { key: string; label: string; variant: string; hint?: string }
export interface LocalModel { id: string; name: string; note: string; effort?: EffortLevel[] }
export const LOCAL_MODELS: LocalModel[] = modelList.models
export const DEFAULT_LOCAL_MODEL: string = modelList.default
export const localModelName = (id: string): string => LOCAL_MODELS.find((m) => m.id === id)?.name ?? id

// OD-74: the reasoning-effort levels a model REALLY honours (from config/models.json), each mapped to an opencode.json
// variant ('' = the model default = thinking on). A fallback keeps two levels if a model has none declared.
const DEFAULT_EFFORT: EffortLevel[] = [
  { key: 'schnell', label: 'Schnell', variant: 'ohne-denken', hint: 'ohne Nachdenken, am schnellsten' },
  { key: 'gruendlich', label: 'Gründlich', variant: '', hint: 'denkt vor dem Antworten' },
]
export const effortLevels = (modelId: string): EffortLevel[] => { const e = LOCAL_MODELS.find((m) => m.id === modelId)?.effort; return e && e.length ? e : DEFAULT_EFFORT }
/** The opencode.json variant for a chosen effort key ('' = model default). Unknown key → the model's first (default) level. */
export const variantForEffort = (modelId: string, key: string): string => { const ls = effortLevels(modelId); return (ls.find((l) => l.key === key) ?? ls[0]).variant }

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
  // OD-16/OD-29/OD-74: the reasoning effort for CARRYING OUT (plan mode always thinks). A level KEY from the model's
  // effort list in config/models.json → an opencode.json variant. Default "schnell" = no thinking (measured 2026-10-15:
  // without thinking 12/12 in 74 min vs with thinking 11/12 in 167 min). The available levels depend on the model: the
  // uncensored/abliterated weights honour only none/on, the original Qwen none/low/medium/xhigh (set under the prompt box).
  effort: string
  // "Claude-Hilfe" range (slider above the prompt box), both as a share of the combined work measured in tokens.
  // offloadShare = MAXIMUM: how much Claude may take over opportunistically (self-contained benign subtasks the local
  // model marks); 0 = no offloading. The safety gate still decides WHAT may leave the PC; this only caps HOW MUCH.
  // offloadMin = MINIMUM (floor): if the local model contributed almost everything (Claude's actual share stayed below
  // this), OpenDante has Claude improve the finished answer once — so a little Claude value is guaranteed even though the
  // local model rarely offloads on its own. 0 = never force it. Enforced MIN ≤ MAX in the UI.
  offloadShare: number
  offloadMin: number
  toggle: (k: keyof Modes) => void
  set: (p: Partial<Pick<State, 'globalInstructions' | 'apiKey' | 'claudeModel' | 'localModel' | 'workdir' | 'folders' | 'thinkingOpen' | 'keepWarmMin' | 'planFirst' | 'claudeDailyUsd' | 'effort' | 'offloadShare' | 'offloadMin' | 'fullAutoAck'>>) => void
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
      effort: 'schnell',
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
    {
      name: 'openllm.modes',
      version: 1,
      // OD-74: an older build stored thinkMode (schnell/gruendlich); carry it over to the new `effort` key so a chosen
      // "gruendlich" is not lost (the keys match for the default model).
      migrate: (s, version) => { const st = (s || {}) as Partial<State> & { thinkMode?: string }; if (version < 1 && st.thinkMode && !st.effort) st.effort = st.thinkMode; return st as State },
    },
  ),
)

/** The slider's range: Claude may take over at most half the work, so the local model stays the lead. */
export const OFFLOAD_SHARE_MAX = 0.5

/** Prepended to a prompt when Autopilot is on, so the local model follows the batch-autopilot skill. */
export const AUTOPILOT_PREFIX =
  'Arbeite nach dem Skill "batch-autopilot": in kleinen Etappen, mit FORTSCHRITT.md als Gedächtnis, und führe nach jedem Schritt die Tests aus. '
