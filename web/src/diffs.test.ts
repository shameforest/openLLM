import { describe, expect, it } from 'vitest'
import { cleanPatch } from './diffs'

describe('cleanPatch (OD-31)', () => {
  it('ignores lines that only changed from LF to CRLF (the real patch from the browser test)', () => {
    const patch = 'Index: rechner.py\n===\n--- rechner.py\t\n+++ rechner.py\t\n@@ -1,3 +1,6 @@\n-def addiere(a, b):\n-    return a + b\n+def addiere(a, b):\r\n+    return a + b\r\n \r\n+def subtrahiere(a, b):\r\n+    return a - b\n+\r\n '
    const c = cleanPatch(patch)
    expect(c.deletions).toBe(0)
    expect(c.additions).toBe(3)
    expect(c.patch).toContain(' def addiere(a, b):')
    expect(c.patch).toContain('+def subtrahiere(a, b):')
    expect(c.patch).not.toContain('\r')
  })
  it('keeps real changes', () => {
    const c = cleanPatch('@@ -1,2 +1,2 @@\n-x = 1\n+x = 2\n y = 3')
    expect(c).toEqual({ patch: '@@ -1,2 +1,2 @@\n-x = 1\n+x = 2\n y = 3', additions: 1, deletions: 1 })
  })
  it('handles an empty patch', () => {
    expect(cleanPatch('')).toEqual({ patch: '', additions: 0, deletions: 0 })
  })
})
