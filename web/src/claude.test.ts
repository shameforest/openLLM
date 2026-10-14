import { describe, expect, it } from 'vitest'
import { offloadTasks } from './claude'

describe('offloadTasks', () => {
  it('extracts a single marked subtask, trimmed', () => {
    const t = 'Ich mache den Rest. <<<CLAUDE\nSchreibe eine Funktion zum Umkehren eines Strings.\n>>> Danke.'
    expect(offloadTasks(t)).toEqual(['Schreibe eine Funktion zum Umkehren eines Strings.'])
  })

  it('extracts several blocks', () => {
    const t = '<<<CLAUDE eins >>> text <<<CLAUDE zwei >>>'
    expect(offloadTasks(t)).toEqual(['eins', 'zwei'])
  })

  it('returns nothing when there is no marker', () => {
    expect(offloadTasks('ganz normale Antwort ohne Marker')).toEqual([])
  })

  it('ignores an empty marker', () => {
    expect(offloadTasks('<<<CLAUDE   >>>')).toEqual([])
  })
})
