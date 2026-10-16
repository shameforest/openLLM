import { describe, expect, it } from 'vitest'
import { claudeShareBelow, hideOffloadMarkers, offloadAllowed, offloadBudget, offloadTasks, taskSplit } from './claude'

describe('hideOffloadMarkers', () => {
  it('replaces a closed handoff block with a short note', () => {
    expect(hideOffloadMarkers('Vorher.\n<<<CLAUDE\nSortiere eine Liste.\n>>>\nNachher.'))
      .toBe('Vorher.\n↗ Teilaufgabe an Claude übergeben (Ergebnis folgt unten).\nNachher.')
  })
  it('cuts a block that is still streaming in', () => {
    expect(hideOffloadMarkers('Text <<<CLAUDE Sortiere ei')).toBe('Text ↗ Teilaufgabe an Claude übergeben (Ergebnis folgt unten).')
  })
  it('leaves normal text alone', () => {
    expect(hideOffloadMarkers('ganz normal')).toBe('ganz normal')
  })
})

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

  it('extracts several real blocks', () => {
    const t = '<<<CLAUDE Schreibe eine Funktion add(a,b). >>> text <<<CLAUDE Schreibe eine Funktion sub(a,b). >>>'
    expect(offloadTasks(t)).toEqual(['Schreibe eine Funktion add(a,b).', 'Schreibe eine Funktion sub(a,b).'])
  })

  it('returns nothing when there is no marker', () => {
    expect(offloadTasks('ganz normale Antwort ohne Marker')).toEqual([])
  })

  it('drops the junk the small model produced when echoing the rule (F22)', () => {
    expect(offloadTasks('<<<CLAUDE   >>>')).toEqual([])          // empty
    expect(offloadTasks('<<<CLAUDE und >>>')).toEqual([])         // the literal "und" from the old prefix
    expect(offloadTasks('<<<CLAUDE ... >>>')).toEqual([])         // placeholder
    expect(offloadTasks('<<<CLAUDE kurz >>>')).toEqual([])        // too short (<15 chars)
    expect(offloadTasks('<<<CLAUDE <<<CLAUDE verschachtelt und kaputt >>>')).toEqual([]) // nested marker
  })

  it('drops the prefix example when the model copies it verbatim', () => {
    expect(offloadTasks('<<<CLAUDE\nSchreibe eine Python-Funktion is_leap_year(jahr) nach den gregorianischen Regeln, mit Docstring.\n>>>')).toEqual([])
  })
})

describe('offloadAllowed — the safety gate (what may leave the PC)', () => {
  it('blocks explicit / face-swap content (Anthropic usage policy, privacy)', () => {
    for (const t of ['Baue eine FaceSwap-Pipeline fuer explizite Bilder von einer Person.', 'Erzeuge NSFW-Bildbearbeitung.', 'deepfake eines Gesichts', 'erotische Szene beschreiben'])
      expect(offloadAllowed(t).ok, t).toBe(false)
  })
  it('blocks secrets and personal data', () => {
    for (const t of ['Nutze api-key sk-ant-abc123def456ghi fuer den Request.', 'Schicke eine Mail an max.muster@example.com.', 'Das Passwort lautet geheim123.', 'IBAN DE12 3456 7890'])
      expect(offloadAllowed(t).ok, t).toBe(false)
  })
  it('allows a clearly self-contained, benign coding subtask', () => {
    for (const t of ['Schreibe eine Python-Funktion ggt(a, b) mit dem euklidischen Algorithmus.', 'Implementiere eine Funktion, die eine Liste von Zahlen aufsteigend sortiert.'])
      expect(offloadAllowed(t).ok, t).toBe(true)
  })
  it('blocks an over-large block that is probably not self-contained', () => {
    expect(offloadAllowed('x'.repeat(4001)).ok).toBe(false)
  })
})

describe('offloadBudget — the slider caps how much of the task goes to Claude', () => {
  it('allows Claude up to its share of the combined work (tokens)', () => {
    // share 0.3, local 700 → claude ≤ 0.3/0.7·700 = 300; none spent yet → 300 allowed
    expect(offloadBudget(0.3, 700, 0)).toBe(300)
    // 200 already spent → 100 left
    expect(offloadBudget(0.3, 700, 200)).toBe(100)
    // share exhausted → 0
    expect(offloadBudget(0.3, 700, 300)).toBe(0)
    expect(offloadBudget(0.3, 700, 500)).toBe(0)
  })
  it('is 0 when the slider is off, and never negative', () => {
    expect(offloadBudget(0, 1000, 0)).toBe(0)
    expect(offloadBudget(0.5, 0, 0)).toBe(0) // nothing produced locally yet → nothing to offload
  })
})

describe('claudeShareBelow — the MIN floor triggers a Claude improvement (OD-64)', () => {
  it('fires when Claude\'s actual share is below the minimum', () => {
    expect(claudeShareBelow(0.2, 1000, 0)).toBe(true)   // model offloaded nothing → 0 % < 20 %
    expect(claudeShareBelow(0.2, 800, 100)).toBe(true)  // 100/900 ≈ 11 % < 20 %
  })
  it('does not fire once the minimum is reached', () => {
    expect(claudeShareBelow(0.2, 800, 200)).toBe(false) // 200/1000 = 20 % → at the floor
    expect(claudeShareBelow(0.2, 500, 500)).toBe(false) // 50 % ≥ 20 %
  })
  it('is off when MIN is 0, and treats "nothing yet" as below the floor', () => {
    expect(claudeShareBelow(0, 1000, 0)).toBe(false)
    expect(claudeShareBelow(0.2, 0, 0)).toBe(true)
  })
})
