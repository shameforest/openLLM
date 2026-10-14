import { describe, expect, it } from 'vitest'
import { type SkillInfo, expandSkillCommand } from './skills'

const list: SkillInfo[] = [
  { slug: 'test-zuerst', name: 'test-zuerst', description: 'TDD' },
  { slug: 'gruendlich-debuggen', name: 'gruendlich-debuggen', description: 'debug' },
]

describe('expandSkillCommand', () => {
  it('expands a bare /slug into a skill instruction', () => {
    const out = expandSkillCommand('/test-zuerst', list)
    expect(out).toContain('test-zuerst')
    expect(out).not.toMatch(/^\//) // the raw command is gone
  })

  it('keeps the rest of the message after the command', () => {
    const out = expandSkillCommand('/test-zuerst baue eine CSV-Funktion', list)
    expect(out).toContain('test-zuerst')
    expect(out).toContain('baue eine CSV-Funktion')
  })

  it('leaves unknown commands untouched', () => {
    expect(expandSkillCommand('/gibtsnicht mach was', list)).toBe('/gibtsnicht mach was')
  })

  it('leaves normal text untouched', () => {
    expect(expandSkillCommand('schreib mir eine Funktion', list)).toBe('schreib mir eine Funktion')
  })

  it('is case-insensitive on the slug', () => {
    expect(expandSkillCommand('/Test-Zuerst', list)).toContain('test-zuerst')
  })
})
