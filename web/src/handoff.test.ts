import { describe, expect, it } from 'vitest'
import { applyBriefing, auditBriefing, offloadBriefing } from './handoff'

describe('handoff briefings', () => {
  it('offload wraps just the task, standalone, no extra context', () => {
    const b = offloadBriefing('  Schreibe eine Funktion summe(spalte) für eine CSV.  ')
    expect(b).toContain('Schreibe eine Funktion summe(spalte) für eine CSV.')
    expect(b).toContain('Eigenständige Teilaufgabe')
    expect(b).not.toMatch(/FORTSCHRITT|OpenDante|Projektkontext/i) // nothing about the wider task leaks in
  })

  it('audit asks for a ranked list and includes the content in a code fence', () => {
    const plan = auditBriefing('plan', '1. Datei X\n2. Test Y')
    expect(plan).toContain('Plan')
    expect(plan).toContain('```\n1. Datei X\n2. Test Y\n```')
    const code = auditBriefing('code', 'def f(): return 1')
    expect(code).toContain('Code')
    expect(code).toContain('def f(): return 1')
  })

  it('applyBriefing frames the pasted answer for the local model', () => {
    expect(applyBriefing('audit', ' mach A besser ')).toMatch(/^Hier ist ein Audit.*mach A besser$/s)
    expect(applyBriefing('offload', 'der code')).toMatch(/^Hier ist das Ergebnis.*der code$/s)
  })
})
