import { describe, expect, it } from 'vitest'
import { activeModelTakesImages, modelCapsFrom } from './api'

// OD-72: the image-support check that drives the "model can't read images" warning. Pure, so it is unit-testable.
describe('model image capability (OD-72)', () => {
  const data: Parameters<typeof modelCapsFrom>[0] = {
    providers: [
      { id: 'ollama', models: {
        'orcarouter/Qwen3.8-27B-Uncensored:q4_K_M': { capabilities: { attachment: true, input: { image: true } } },
        'text-only:7b': { capabilities: { attachment: false, input: { image: false } } },
      } },
      { id: 'anthropic', models: { 'claude-sonnet-5-5': { capabilities: { attachment: true, input: { image: true } } } } },
    ],
  }
  it('flattens providers into "provider/model" → caps', () => {
    const caps = modelCapsFrom(data)
    expect(caps['ollama/orcarouter/Qwen3.8-27B-Uncensored:q4_K_M']).toEqual({ attachment: true, image: true })
    expect(caps['ollama/text-only:7b']).toEqual({ attachment: false, image: false })
    expect(caps['anthropic/claude-sonnet-5-5'].image).toBe(true)
  })
  it('tolerates missing providers/models/capabilities', () => {
    expect(modelCapsFrom({})).toEqual({})
    expect(modelCapsFrom({ providers: [{ id: 'x' }] })).toEqual({})
    expect(modelCapsFrom({ providers: [{ id: 'x', models: { m: {} } }] })['x/m']).toEqual({ attachment: false, image: false })
  })
  it('activeModelTakesImages is true/false, or null when the model is unknown (so we never warn blindly)', () => {
    const caps = modelCapsFrom(data)
    expect(activeModelTakesImages(caps, 'ollama', 'orcarouter/Qwen3.8-27B-Uncensored:q4_K_M')).toBe(true)
    expect(activeModelTakesImages(caps, 'ollama', 'text-only:7b')).toBe(false)
    expect(activeModelTakesImages(caps, 'ollama', 'not-loaded')).toBe(null)
    expect(activeModelTakesImages({}, 'ollama', 'orcarouter/Qwen3.8-27B-Uncensored:q4_K_M')).toBe(null)
  })
})
