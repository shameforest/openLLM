import { describe, expect, it } from 'vitest'
import { splitThinking } from './stream'

describe('splitThinking', () => {
  it('returns all text as the answer when there is no think tag', () => {
    expect(splitThinking('Hallo Welt')).toEqual({ thinking: '', answer: 'Hallo Welt' })
  })

  it('separates a closed <think> block from the answer', () => {
    expect(splitThinking('<think>erst überlegen</think>Die Antwort')).toEqual({ thinking: 'erst überlegen', answer: 'Die Antwort' })
  })

  it('treats an unclosed <think> (still streaming) as all thinking, empty answer', () => {
    expect(splitThinking('<think>ich denke noch')).toEqual({ thinking: 'ich denke noch', answer: '' })
  })

  it('keeps text before and after the think block in the answer', () => {
    expect(splitThinking('A<think>x</think>B')).toEqual({ thinking: 'x', answer: 'AB' })
  })
})
