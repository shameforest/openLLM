import { describe, expect, it } from 'vitest'
import modelList from '../../config/models.json'
import ocConfig from '../../config/opencode.json'
import { DEFAULT_LOCAL_MODEL, LOCAL_MODELS, effortLevels, variantForEffort } from './settings'

// config/models.json is the one list of local models. OpenCode's own config cannot import it, so this test fails the
// moment config/opencode.json drifts away from it (a model added in one place but not the other).
const oc = ocConfig as unknown as { model: string; provider: { ollama: { models: Record<string, unknown> } } }

describe('one model list', () => {
  it('the app uses config/models.json', () => {
    expect(LOCAL_MODELS.map((m) => m.id)).toEqual(modelList.models.map((m) => m.id))
    expect(DEFAULT_LOCAL_MODEL).toBe(modelList.default)
  })
  it('the default is one of the models', () => {
    expect(modelList.models.some((m) => m.id === modelList.default)).toBe(true)
  })
  it('opencode.json lists exactly the same models and the same default', () => {
    expect(Object.keys(oc.provider.ollama.models).sort()).toEqual(modelList.models.map((m) => m.id).sort())
    expect(oc.model).toBe(`ollama/${modelList.default}`)
  })
  it('every effort level maps to a defined opencode.json variant (OD-74)', () => {
    const ocModels = oc.provider.ollama.models as Record<string, { variants?: Record<string, unknown> }>
    const missing: string[] = []
    for (const m of modelList.models as { id: string; effort?: { key: string; variant: string }[] }[]) {
      for (const lvl of m.effort ?? []) {
        if (lvl.variant === '') continue // '' = the model default (thinking on, no variant needed)
        if (!ocModels[m.id]?.variants?.[lvl.variant]) missing.push(`${m.id}: ${lvl.variant}`)
      }
    }
    expect(missing).toEqual([])
  })
  it('effortLevels/variantForEffort resolve per model, with a fallback (OD-74)', () => {
    const def = DEFAULT_LOCAL_MODEL
    expect(effortLevels(def).map((l) => l.key)).toContain('schnell')
    expect(variantForEffort(def, 'schnell')).toBe('ohne-denken')
    expect(variantForEffort(def, 'gruendlich')).toBe('') // '' = default = thinking on
    expect(variantForEffort('qwen3.8:27b', 'hoch')).toBe('denken-hoch')
    expect(variantForEffort(def, 'gibts-nicht')).toBe(effortLevels(def)[0].variant) // unknown key → first level
    expect(variantForEffort('unbekanntes-modell', 'schnell')).toBe('ohne-denken') // unknown model → fallback levels
  })
  it('opencode.json has no comment keys inside blocks (they make OpenCode refuse the whole config)', () => {
    const bad: string[] = []
    const walk = (o: unknown, at: string) => {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return
      for (const [k, v] of Object.entries(o)) {
        if (k.startsWith('_') && at !== '') bad.push(`${at}.${k}`)
        walk(v, at ? `${at}.${k}` : k)
      }
    }
    walk(oc, '')
    expect(bad).toEqual([])
  })
})
