import { describe, expect, it } from 'vitest'
import { detectLoop } from './loops'
import type { ToolCall } from './stream'

let n = 0
const call = (tool: string, title: string, status: ToolCall['status'] = 'completed'): ToolCall => ({ id: `t${++n}`, tool, title, status })

describe('detectLoop', () => {
  it('stays quiet for normal progress', () => {
    expect(detectLoop([call('write', 'a.py'), call('bash', 'python a.py'), call('edit', 'a.py'), call('bash', 'python a.py')])).toBeNull()
    expect(detectLoop([])).toBeNull()
  })
  it('notices the same step failing three times', () => {
    const t = [call('bash', 'npm test', 'error'), call('edit', 'x.ts'), call('bash', 'npm test', 'error'), call('bash', 'npm test', 'error')]
    expect(detectLoop(t)).toMatch(/3-mal fehlgeschlagen \(bash\)/)
  })
  it('notices oscillating between two steps', () => {
    const t = [call('edit', 'a.ts'), call('bash', 'npm test'), call('edit', 'a.ts'), call('bash', 'npm test'), call('edit', 'a.ts'), call('bash', 'npm test')]
    expect(detectLoop(t)).toMatch(/pendelt.*edit ↔ bash/)
  })
  it('notices the same step four times in a row', () => {
    expect(detectLoop([call('read', 'big.ts'), call('read', 'big.ts'), call('read', 'big.ts'), call('read', 'big.ts')])).toMatch(/viermal/)
  })
  it('ignores calls that are still running', () => {
    expect(detectLoop([call('read', 'x'), call('read', 'x'), call('read', 'x'), call('read', 'x', 'running')])).toBeNull()
  })
})
