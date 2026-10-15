import { useEffect, useRef } from 'react'
import type { ToolCall } from './stream'

// Right-hand sidebar with the agent's process: its chain-of-thought, the tool steps it ran and the subtasks it handed to
// Claude. The main window shows only the final answer. Folds down to a thin strip; the choice is remembered.

export interface Thought {
  key: string
  prompt: string     // the user's request this turn answered (for orientation)
  thinking: string
  tools: ToolCall[]
  offloads: string[] // subtasks the local model handed to Claude
  live: boolean
}

export function ThinkingSidebar({ open, onToggle, items }: { open: boolean; onToggle: () => void; items: Thought[] }) {
  const live = items.some((t) => t.live)
  const scrollRef = useRef<HTMLDivElement>(null)
  const last = items[items.length - 1]
  const lastSize = last ? last.thinking.length + last.tools.length : 0

  // Follow the live thinking, but only while the reader is already at the bottom (so scrolling up to read stays put).
  useEffect(() => {
    const el = scrollRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight
  }, [lastSize, items.length, open])

  if (!open) {
    return (
      <aside className="flex w-11 shrink-0 flex-col items-center border-l border-line bg-panel py-3">
        <button className="flex flex-col items-center gap-3 rounded-lg px-1.5 py-2 text-ink3 hover:bg-user hover:text-ink2"
          onClick={onToggle} aria-expanded={false} aria-label="Gedankengang einblenden" title="Gedankengang einblenden" data-testid="thinking-open">
          <span className="text-[14px]">‹</span>
          <span className="text-[12px] tracking-wide [writing-mode:vertical-rl]">Gedankengang</span>
          {live && <span className="size-2 rounded-full bg-live" style={{ animation: 'pulse 1.2s ease-in-out infinite' }} title="denkt gerade nach" />}
        </button>
      </aside>
    )
  }

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-line bg-panel" data-testid="thinking-sidebar">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium">Gedankengang</span>
          {live && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-ink3">
              <span className="size-2 rounded-full bg-live" style={{ animation: 'pulse 1.2s ease-in-out infinite' }} />denkt nach…
            </span>
          )}
        </div>
        <button className="rounded-md px-2 py-1 text-[14px] text-ink3 hover:bg-user hover:text-ink2"
          onClick={onToggle} aria-expanded={true} aria-label="Gedankengang ausblenden" title="Ausblenden" data-testid="thinking-close">›</button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {items.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-ink3">
            Hier siehst du, wie OpenDante nachdenkt und welche Schritte es ausführt. Die Antwort selbst steht links im Hauptfenster.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((t, i) => <ThoughtBlock key={t.key} t={t} latest={i === items.length - 1} />)}
          </div>
        )}
      </div>
    </aside>
  )
}

function ThoughtBlock({ t, latest }: { t: Thought; latest: boolean }) {
  const empty = !t.thinking.trim() && t.tools.length === 0 && t.offloads.length === 0
  return (
    // Older turns start folded so the newest one is easy to find; React only re-applies `open` when `latest` changes.
    <details open={latest} className="group rounded-lg border border-line bg-bg" data-testid="thought">
      <summary className="flex cursor-pointer list-none items-start gap-1.5 px-3 py-2 text-[12px] text-ink2">
        <span className="mt-px inline-block w-3 text-ink3 group-open:rotate-90">▸</span>
        <span className="min-w-0 flex-1 truncate" title={t.prompt}>{t.prompt || 'Antwort'}</span>
        {t.live && <span className="shrink-0 text-ink3">läuft…</span>}
      </summary>
      <div className="border-t border-line px-3 py-2">
        {t.tools.length > 0 && (
          <div className="mb-2">
            <div className="mb-1 text-[11px] uppercase tracking-wider text-ink3">Schritte</div>
            <div className="flex flex-wrap gap-1.5">
              {t.tools.map((tc) => (
                <span key={tc.id} className="mono inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1 text-[11px] text-ink2">
                  <span className={`size-1.5 rounded-full ${tc.status === 'completed' ? 'bg-emerald-500' : tc.status === 'error' ? 'bg-red-500' : 'bg-accent'}`} />
                  {tc.tool}{tc.title ? ` · ${tc.title}` : ''}
                </span>
              ))}
            </div>
          </div>
        )}
        {t.offloads.map((o, i) => (
          <div key={i} className="mb-2 rounded-md border border-sky-400/30 px-2 py-1.5 text-[12px] text-sky-300/90">
            <span className="font-medium">↗ an Claude übergeben:</span> <span className="whitespace-pre-wrap">{o}</span>
          </div>
        ))}
        {t.thinking.trim() && (
          <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink3" data-testid="thinking-text">{t.thinking.trim()}</div>
        )}
        {empty && <div className="text-[12px] italic text-ink3">{t.live ? 'wartet auf das Modell…' : 'Kein Gedankengang aufgezeichnet.'}</div>}
      </div>
    </details>
  )
}
