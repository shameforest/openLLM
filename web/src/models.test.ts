import { describe, expect, it } from 'vitest'
import modelList from '../../config/models.json'
import ocConfig from '../../config/opencode.json'
import { DEFAULT_LOCAL_MODEL, LOCAL_MODELS } from './settings'

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
