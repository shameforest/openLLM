import { Fragment, type ReactNode, useState } from 'react'

// OD-59: a lightweight Markdown renderer for answers — no dependency, themed for the dark UI. It handles what the local
// model actually produces: fenced code blocks (with a copy button and a language label), inline code, headings,
// bold/italic, links, and bullet/numbered lists. Everything is built as React elements (never innerHTML), so model
// output cannot inject HTML. Full syntax colouring would need a library and is left out on purpose (bundle discipline).

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    try { void navigator.clipboard?.writeText(code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }) } catch { /* no clipboard */ }
  }
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-line" data-testid="code-block">
      <div className="flex items-center justify-between border-b border-line bg-bg px-3 py-1 text-[11px] text-ink3">
        <span className="mono">{lang || 'Code'}</span>
        <button className="rounded px-1.5 py-0.5 hover:bg-user hover:text-ink2" onClick={copy} data-testid="code-copy">{copied ? '✓ Kopiert' : '⧉ Kopieren'}</button>
      </div>
      <pre className="mono overflow-x-auto bg-panel px-3 py-2 text-[12.5px] leading-relaxed text-ink"><code>{code}</code></pre>
    </div>
  )
}

// Inline formatting → React nodes: `code`, **bold**, *italic* / _italic_, and [text](url). Processed left to right.
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]]+\]\((?:https?:\/\/|file:|mailto:)[^)\s]+\))/
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let k = 0
  while (rest) {
    const m = INLINE.exec(rest)
    if (!m || m.index === undefined) { out.push(rest); break }
    if (m.index > 0) out.push(rest.slice(0, m.index))
    const tok = m[0]
    const key = `${keyBase}-${k++}`
    if (tok.startsWith('`')) out.push(<code key={key} className="mono rounded bg-bg px-1 py-0.5 text-[0.9em] text-ink">{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!
      out.push(<a key={key} href={mm[2]} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2 hover:text-ink">{mm[1]}</a>)
    } else out.push(<em key={key}>{tok.slice(1, -1)}</em>)
    rest = rest.slice(m.index + tok.length)
  }
  return out
}

// A run of non-code text → headings, lists and paragraphs.
function MdBlocks({ text, keyBase }: { text: string; keyBase: string }) {
  const lines = text.replace(/\n{3,}/g, '\n\n').split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flushPara = () => { if (para.length) { const key = `${keyBase}-p${blocks.length}`; blocks.push(<p key={key} className="my-1.5 first:mt-0 last:mb-0">{inline(para.join(' '), key)}</p>); para = [] } }
  const flushList = () => {
    if (!list) return
    const key = `${keyBase}-l${blocks.length}`
    const items = list.items.map((it, i) => <li key={`${key}-${i}`}>{inline(it, `${key}-${i}`)}</li>)
    blocks.push(list.ordered ? <ol key={key} className="my-1.5 ml-5 list-decimal space-y-0.5">{items}</ol> : <ul key={key} className="my-1.5 ml-5 list-disc space-y-0.5">{items}</ul>)
    list = null
  }
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    const uli = /^\s*[-*]\s+(.*)$/.exec(line)
    const oli = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (h) { flushPara(); flushList(); const key = `${keyBase}-h${blocks.length}`; const sz = ['text-[18px]', 'text-[16px]', 'text-[15px]', 'text-[14px]'][h[1].length - 1]; blocks.push(<div key={key} className={`mb-1 mt-2 font-semibold first:mt-0 ${sz}`}>{inline(h[2], key)}</div>) }
    else if (uli || oli) { flushPara(); const ordered = !!oli; if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] } } list.items.push((uli ?? oli)![1]) }
    else if (!line.trim()) { flushPara(); flushList() }
    else { flushList(); para.push(line) }
  }
  flushPara(); flushList()
  return <>{blocks}</>
}

/** Render Markdown text (an assistant answer). `live` adds a blinking caret at the end while it streams. */
export function Markdown({ text, live, caret }: { text: string; live?: boolean; caret?: ReactNode }) {
  const parts: { t: 'md' | 'code'; s: string; lang?: string }[] = []
  const re = /```([^\n`]*)\n?([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ t: 'md', s: text.slice(last, m.index) })
    parts.push({ t: 'code', lang: m[1].trim(), s: m[2].replace(/\n$/, '') })
    last = re.lastIndex
  }
  const tail = text.slice(last)
  const open = tail.indexOf('```') // a code fence still streaming in (no closing ``` yet)
  if (open >= 0) {
    if (open > 0) parts.push({ t: 'md', s: tail.slice(0, open) })
    const after = tail.slice(open + 3)
    const nl = after.indexOf('\n')
    parts.push({ t: 'code', lang: (nl >= 0 ? after.slice(0, nl) : after).trim(), s: nl >= 0 ? after.slice(nl + 1) : '' })
  } else if (tail) parts.push({ t: 'md', s: tail })

  return (
    <div className="text-[15px] leading-relaxed text-ink" data-testid="answer-md">
      {parts.map((p, i) => (
        <Fragment key={i}>{p.t === 'code' ? <CodeBlock code={p.s} lang={p.lang ?? ''} /> : <MdBlocks text={p.s} keyBase={`b${i}`} />}</Fragment>
      ))}
      {live && caret}
    </div>
  )
}
