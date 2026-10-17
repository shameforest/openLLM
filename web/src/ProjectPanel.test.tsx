import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ProjectPanel } from './ProjectPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const jsonRes = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response

describe('ProjectPanel (OD-73)', () => {
  let host: HTMLDivElement
  let root: Root
  let posts: { url: string; body: unknown }[]
  beforeEach(() => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    posts = []
    globalThis.fetch = vi.fn(async (url: string | URL | Request, opts?: RequestInit) => {
      const u = String(url)
      if (opts?.method === 'POST') { posts.push({ url: u, body: JSON.parse(String(opts.body || '{}')) }); return jsonRes({ ok: true, id: 'knew', name: 'neu.txt', chars: 40 }) }
      if (u.includes('/project-meta')) return jsonRes({ name: 'Mein Projekt', description: 'Beschreibung', createdAt: 1 })
      if (u.includes('/project-knowledge')) return jsonRes({ items: [{ id: 'k1', name: 'regeln.md', chars: 800 }], chars: 800, tokens: 200 })
      return jsonRes({})
    }) as typeof fetch
  })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

  const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
  const show = async (dir: string) => { await act(async () => { root.render(<ProjectPanel open dir={dir} instructions="Sei knapp." onClose={() => {}} onOpenInstructions={() => {}} />) }); await flush() }

  it('shows the no-project state when there is no working folder', async () => {
    await show('')
    expect(host.querySelector('[data-testid="project-none"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="project-knowledge-list"]')).toBeNull()
  })

  it('loads name, knowledge items and a capacity bar for a project folder', async () => {
    await show('C:/proj')
    expect((host.querySelector('[data-testid="project-name"]') as HTMLInputElement).value).toBe('Mein Projekt')
    expect(host.querySelectorAll('[data-testid="project-knowledge-item"]').length).toBe(1)
    expect(host.textContent).toMatch(/regeln\.md/)
    expect(host.querySelector('[data-testid="project-capacity"]')).not.toBeNull()
    expect(host.textContent).toMatch(/passt ganz hinein/) // 200 tokens ≤ budget → loaded whole
  })

  it('adds a text knowledge item via the companion', async () => {
    await show('C:/proj')
    act(() => (host.querySelector('[data-testid="project-add-text"]') as HTMLButtonElement).click())
    const ta = host.querySelector('[data-testid="project-text-input"]') as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => { setter.call(ta, 'Neue Regel'); ta.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { (host.querySelector('[data-testid="project-text-save"]') as HTMLButtonElement).click() })
    await flush()
    const add = posts.find((p) => p.url.endsWith('/project-knowledge'))
    expect(add && (add.body as { content: string }).content).toBe('Neue Regel')
  })
})
