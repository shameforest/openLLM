import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AlwaysAllowed } from './AlwaysAllowed'
import type { AlwaysGrant } from './storage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('AlwaysAllowed (OD-63)', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove() })

  const grants: AlwaysGrant[] = [
    { pat: 'npm *', kind: 'bash', at: 0 },
    { pat: 'C:/proj/src/App.tsx', kind: 'edit', at: 0 },
  ]

  it('lists every grant with a readable kind and a revoke button', () => {
    const onRevoke = vi.fn()
    act(() => root.render(<AlwaysAllowed open dir="C:/proj" grants={grants} onClose={() => {}} onRevoke={onRevoke} onClearAll={() => {}} />))
    const rows = host.querySelectorAll('[data-testid="always-row"]')
    expect(rows.length).toBe(2)
    expect(host.textContent).toMatch(/npm \*/)
    expect(host.textContent).toMatch(/Befehl/)
    expect(host.textContent).toMatch(/Datei/)
    const btn = host.querySelector('[data-testid="always-revoke"]') as HTMLButtonElement
    act(() => btn.click())
    expect(onRevoke).toHaveBeenCalledWith('npm *')
  })

  it('shows an empty state and no "Alle widerrufen" when nothing is granted', () => {
    act(() => root.render(<AlwaysAllowed open dir="C:/proj" grants={[]} onClose={() => {}} onRevoke={() => {}} onClearAll={() => {}} />))
    expect(host.querySelector('[data-testid="always-empty"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="always-clear"]')).toBeNull()
  })

  it('renders nothing when closed', () => {
    act(() => root.render(<AlwaysAllowed open={false} dir="C:/proj" grants={grants} onClose={() => {}} onRevoke={() => {}} onClearAll={() => {}} />))
    expect(host.querySelector('[data-testid="always-allowed"]')).toBeNull()
  })
})
