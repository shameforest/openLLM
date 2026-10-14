import { describe, expect, it } from 'vitest'
import { offloadTasks, taskSplit } from './claude'

describe('taskSplit', () => {
  it('splits by output tokens and sums to 100', () => {
    const s = taskSplit(700, 300)
    expect(s).toEqual({ localPct: 70, claudePct: 30 })
  })
  it('is all-local when Claude did nothing', () => {
    expect(taskSplit(500, 0)).toEqual({ localPct: 100, claudePct: 0 })
  })
  it('never divides by zero', () => {
    expect(taskSplit(0, 0)).toEqual({ localPct: 0, claudePct: 100 })
  })
})

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
