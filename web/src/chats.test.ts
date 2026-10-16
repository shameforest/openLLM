import { describe, expect, it } from 'vitest'
import { chatTitle, filterChats, newChatId, relDate } from './chats'

describe('chats helpers', () => {
  it('makes ids the companion accepts as file names', () => {
    const id = newChatId()
    expect(id).toMatch(/^[a-z0-9-]{8,64}$/)
    expect(newChatId()).not.toBe(id)
  })
  it('titles a chat from its first request, one line, max 60 chars', () => {
    expect(chatTitle('  Baue mir\n einen Taschenrechner  ')).toBe('Baue mir einen Taschenrechner')
    const long = chatTitle('x'.repeat(100))
    expect(long.length).toBe(60)
    expect(long.endsWith('…')).toBe(true)
    expect(chatTitle('   ')).toBe('Neuer Chat')
  })
  it('filters the Verlauf by a case-insensitive title substring, empty query → all (OD-62)', () => {
    const list = [{ title: 'Taschenrechner bauen' }, { title: 'CSV einlesen' }, { title: 'rechner testen' }]
    expect(filterChats(list, '').length).toBe(3)
    expect(filterChats(list, '   ').length).toBe(3)
    expect(filterChats(list, 'rechner').map((c) => c.title)).toEqual(['Taschenrechner bauen', 'rechner testen'])
    expect(filterChats(list, 'CSV')).toEqual([{ title: 'CSV einlesen' }])
    expect(filterChats(list, 'xyz')).toEqual([])
  })
  it('shows short German relative dates', () => {
    const now = new Date(2026, 9, 15, 12, 0).getTime()
    expect(relDate(now - 20_000, now)).toBe('gerade eben')
    expect(relDate(now - 5 * 60_000, now)).toBe('vor 5 Min.')
    expect(relDate(new Date(2026, 9, 15, 8, 5).getTime(), now)).toBe('08:05')
    expect(relDate(new Date(2026, 9, 14, 22, 0).getTime(), now)).toBe('gestern')
    expect(relDate(new Date(2026, 9, 2).getTime(), now)).toBe('2.10.')
    expect(relDate(new Date(2025, 0, 3).getTime(), now)).toBe('3.1.2025')
  })
})
