import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// The three optional modes, each off by default. Persisted so a choice survives restarts.
export interface Modes {
  autopilot: boolean // work the local model in batches with a memory file (batch-autopilot skill)
  offload: boolean // hand self-contained, benign sub-tasks to Claude Code (manual copy/paste bridge)
  audit: boolean // let Claude Code review the plan and the finished code, then brief the local model
}

interface SettingsState extends Modes {
  toggle: (k: keyof Modes) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      autopilot: false,
      offload: false,
      audit: false,
      toggle: (k) => set((s) => ({ [k]: !s[k] }) as Partial<SettingsState>),
    }),
    { name: 'openllm.modes' },
  ),
)

/** Prepended to a prompt when Autopilot is on, so the local model follows the batch-autopilot skill. */
export const AUTOPILOT_PREFIX =
  'Arbeite nach dem Skill "batch-autopilot": in kleinen Etappen, mit FORTSCHRITT.md als Gedächtnis, und führe nach jedem Schritt die Tests aus. '
