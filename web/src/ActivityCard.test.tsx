import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ToolCall } from './stream'
import { ActivityCard, changedFiles } from './ActivityCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const tool = (t: string, title?: string, status: ToolCall['status'] = 'completed'): ToolCall => ({ id: Math.random().toString(36), tool: t, status, title })

describe('changedFiles', () => {
  it('lists distinct files from edit/write/patch calls, in first-seen order', () => {
    const tools = [tool('read', 'a.py'), tool('edit', 'server/app/db.py'), tool('bash', 'pytest'), tool('write', 'server/app/models.py'), tool('edit', 'server/app/db.py')]
    expect(changedFiles(tools)).toEqual(['server/app/db.py', 'server/app/models.py'])
  })
  it('is empty when nothing was changed', () => {
    expect(changedFiles([tool('read', 'a.py'), tool('bash', 'ls')])).toEqual([])
  })
})

describe('ActivityCard', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove() })
  const show = (tools: ToolCall[]) => act(() => root.render(<ActivityCard tools={tools} />))
  const txt = (id: string) => host.querySelector(`[data-testid="${id}"]`)?.textContent ?? ''

  it('shows the current action and the step count', () => {
    show([tool('read', 'x.py'), tool('edit', 'server/app/db.py')])
    expect(txt('activity-now')).toMatch(/bearbeitet/)
    expect(txt('activity-now')).toMatch(/app\/db\.py/)
    expect(txt('activity-steps')).toBe('2 Schritte')
  })
  it('shows how many files were changed and their short names', () => {
    show([tool('write', 'server/app/models.py'), tool('edit', 'server/app/db.py')])
    expect(txt('activity-files')).toMatch(/2 Dateien geändert/)
    expect(txt('activity-files')).toMatch(/app\/db\.py/)
  })
  it('shortens a long bash command to one line', () => {
    show([tool('bash', 'pytest server/ -v\nmit  vielen   Leerzeichen und sehr langem Text der gekuerzt werden muss definitiv')])
    const t = txt('activity-now')
    expect(t).toMatch(/führt aus/)
    expect(t).not.toMatch(/\n/)
    expect(t.length).toBeLessThan(90)
  })
  it('renders nothing without tools', () => {
    show([])
    expect(host.querySelector('[data-testid="activity-card"]')).toBeNull()
  })
})
