import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FilePicker } from './FilePicker'
import type { Attachment } from './attachments'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const listings: Record<string, unknown> = {
  '': { path: '', parent: null, dirs: [{ name: 'C:', path: 'C:\\' }], files: [] },
  'C:\\': {
    path: 'C:\\', parent: '', dirs: [{ name: 'Daten', path: 'C:\\Daten' }],
    files: [
      { name: 'klein.txt', path: 'C:\\klein.txt', size: 2048 },
      { name: 'riesig.log', path: 'C:\\riesig.log', size: 3 * 1024 * 1024 },
    ],
  },
  'C:\\Daten': { path: 'C:\\Daten', parent: 'C:\\', dirs: [], files: [{ name: 'foto.png', path: 'C:\\Daten\\foto.png', size: 500 }] },
}

let host: HTMLDivElement
let root: Root
const requested: string[] = []

beforeEach(() => {
  requested.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requested.push(url)
    const p = new URL(url).searchParams.get('path') ?? ''
    return new Response(JSON.stringify(listings[p]), { status: 200 })
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
const all = (id: string) => [...host.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[]
const click = (el: HTMLElement) => act(() => { el.click() })

async function openPicker(onPick = vi.fn(), onClose = vi.fn()) {
  act(() => root.render(<FilePicker open onClose={onClose} onPick={onPick} />))
  await flush()
  return { onPick, onClose }
}

describe('FilePicker', () => {
  it('renders nothing while closed', () => {
    act(() => root.render(<FilePicker open={false} onClose={() => {}} onPick={() => {}} />))
    expect(q('file-picker')).toBeNull()
  })

  it('starts at the roots, asks the companion for files, and navigates into a folder', async () => {
    await openPicker()
    expect(requested[0]).toContain('/fs?files=1')
    expect(requested[0]).not.toContain('path=')
    await click(all('fp-open')[0]) // "C:"
    await flush()
    expect(requested[1]).toContain('path=C%3A%5C')
    expect(requested[1]).toContain('files=1')
    expect(all('fp-file').map((r) => r.textContent)).toEqual([expect.stringContaining('klein.txt'), expect.stringContaining('riesig.log')])
  })

  it('shows sizes in KB and flags files over 1 MB', async () => {
    await openPicker()
    await click(all('fp-open')[0]); await flush()
    expect(all('fp-size').map((s) => s.textContent)).toEqual(['2 KB', '3.072 KB'])
    const large = all('fp-large')
    expect(large).toHaveLength(1)
    expect(large[0].textContent).toBe('groß – kostet viel Kontext')
  })

  it('collects ticked files across folders and hands them over with "Anhängen (n)"', async () => {
    const { onPick, onClose } = await openPicker()
    expect((q('fp-confirm') as HTMLButtonElement).disabled).toBe(true)
    expect(q('fp-confirm')!.textContent).toBe('Anhängen (0)')
    await click(all('fp-open')[0]); await flush()
    await click(all('fp-check')[0]) // klein.txt
    await click(all('fp-open')[0]); await flush() // into Daten
    await click(all('fp-file-name')[0]) // foto.png, ticked via its name
    expect(q('fp-confirm')!.textContent).toBe('Anhängen (2)')
    await click(q('fp-confirm')!)
    const picked = onPick.mock.calls[0][0] as Attachment[]
    expect(picked).toEqual([
      { path: 'C:\\klein.txt', name: 'klein.txt', size: 2048 },
      { path: 'C:\\Daten\\foto.png', name: 'foto.png', size: 500 },
    ])
    expect(onClose).toHaveBeenCalled()
  })

  it('closes with the ✕ button and with Escape', async () => {
    const { onClose } = await openPicker()
    await click(q('fp-close')!)
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('starts again at the roots with nothing ticked when it is reopened', async () => {
    await openPicker()
    await click(all('fp-open')[0]); await flush()
    await click(all('fp-check')[0])
    expect(q('fp-confirm')!.textContent).toBe('Anhängen (1)')
    act(() => root.render(<FilePicker open={false} onClose={() => {}} onPick={() => {}} />))
    act(() => root.render(<FilePicker open onClose={() => {}} onPick={() => {}} />))
    await flush()
    expect(q('fp-confirm')!.textContent).toBe('Anhängen (0)')
    expect(requested[requested.length - 1]).not.toContain('path=')
  })
})
