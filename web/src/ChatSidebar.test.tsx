import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ChatSidebar } from './ChatSidebar'
import type { ChatMeta } from './chats'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mk = (title: string, i: number): ChatMeta =>
  ({ id: `chat-${i}`, title, createdAt: 0, updatedAt: 0, workdir: '', model: 'm', messages: 1, usage: {} })

// Type into a React-controlled input the way the browser would (native setter + input event).
const typeInto = (el: HTMLInputElement, v: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  act(() => { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

describe('ChatSidebar Verlauf search (OD-62)', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove() })

  const render = (titles: string[]) => {
    const list = titles.map(mk)
    act(() => root.render(
      <ChatSidebar running={false} stopRun={async () => {}} startNewChat={() => {}}
        setModiOpen={() => {}} modesActive={0} setSettingsOpen={() => {}}
        chats={{ list, loaded: true, rename: async () => {}, remove: async () => {} }}
        activeChat={null} openChat={async () => {}} historyMsg=""
        skills={{ list: [], loaded: true }} setInput={() => {}} inputRef={{ current: null }}
        modes={{ workdir: '', localModel: 'qwen3.8:27b' }} online />,
    ))
  }
  const titles8 = ['Taschenrechner bauen', 'CSV einlesen', 'rechner testen', 'Website Layout', 'Bug im Parser', 'Notizen App', 'Readme schreiben', 'Docker Setup']
  const rows = () => host.querySelectorAll('[data-testid="history-item"]').length
  const searchBox = () => host.querySelector('[data-testid="history-search"]') as HTMLInputElement | null

  it('shows a search box once there are enough chats and filters by title', () => {
    render(titles8)
    expect(searchBox()).not.toBeNull()
    expect(rows()).toBe(8)
    typeInto(searchBox()!, 'rechner')
    const shown = [...host.querySelectorAll('[data-testid="history-item"]')].map((el) => el.textContent)
    expect(shown.length).toBe(2)
    expect(shown.every((t) => /rechner/i.test(t ?? ''))).toBe(true)
  })

  it('shows a "Keine Treffer" state when nothing matches, and clears it', () => {
    render(titles8)
    typeInto(searchBox()!, 'zzz-nichts')
    expect(host.querySelector('[data-testid="history-empty"]')).not.toBeNull()
    expect(rows()).toBe(0)
    const clear = host.querySelector('[data-testid="history-search-clear"]') as HTMLButtonElement
    act(() => clear.click())
    expect(host.querySelector('[data-testid="history-empty"]')).toBeNull()
    expect(rows()).toBe(8)
  })

  it('hides the search box for a short history', () => {
    render(['Nur ein Chat', 'Und noch einer', 'Der dritte'])
    expect(searchBox()).toBeNull()
    expect(rows()).toBe(3)
  })
})
