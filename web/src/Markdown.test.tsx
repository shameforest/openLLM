import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Markdown } from './Markdown'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('Markdown', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove() })
  const show = (text: string) => act(() => root.render(<Markdown text={text} />))

  it('renders a fenced code block with its language and a copy button', () => {
    show('Hier der Code:\n```python\nprint("hallo")\n```\nFertig.')
    const block = host.querySelector('[data-testid="code-block"]')
    expect(block).not.toBeNull()
    expect(block!.querySelector('pre code')!.textContent).toBe('print("hallo")')
    expect(block!.textContent).toMatch(/python/)
    expect(host.querySelector('[data-testid="code-copy"]')!.textContent).toMatch(/Kopieren/)
  })

  it('does not drop the prose around a code block', () => {
    show('Vorher.\n```\ncode\n```\nNachher.')
    expect(host.textContent).toMatch(/Vorher\./)
    expect(host.textContent).toMatch(/Nachher\./)
  })

  it('renders an unclosed (streaming) code fence as a code block', () => {
    show('Ich schreibe:\n```js\nconst a = 1')
    const block = host.querySelector('[data-testid="code-block"]')
    expect(block).not.toBeNull()
    expect(block!.querySelector('pre code')!.textContent).toBe('const a = 1')
  })

  it('renders inline code, bold and a link as real elements (no raw markdown left)', () => {
    show('Nutze `npm test`, das ist **wichtig**, siehe [Docs](https://example.com).')
    expect(host.querySelector('code')!.textContent).toBe('npm test')
    expect(host.querySelector('strong')!.textContent).toBe('wichtig')
    const a = host.querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://example.com')
    expect(a.textContent).toBe('Docs')
    expect(host.textContent).not.toMatch(/\*\*|\]\(/)
  })

  it('renders headings and bullet/numbered lists', () => {
    show('# Titel\n- eins\n- zwei\n\n1. a\n2. b')
    expect(host.querySelectorAll('ul li').length).toBe(2)
    expect(host.querySelectorAll('ol li').length).toBe(2)
    expect(host.textContent).toMatch(/Titel/)
    expect(host.textContent).not.toMatch(/^#|^- |^\d\./m)
  })

  it('never injects HTML from the text (no XSS)', () => {
    show('<img src=x onerror=alert(1)> und <b>fett</b>')
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('b')).toBeNull()
    expect(host.textContent).toMatch(/<img src=x/)
  })
})
