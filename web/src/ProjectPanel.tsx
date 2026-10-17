import { useCallback, useEffect, useState } from 'react'
import { type KnowledgeItem, type ProjectMeta, addKnowledge, getKnowledge, getProjectMeta, removeKnowledge, saveProjectMeta } from './companion'
import { CONTEXT_LIMIT } from './messages'
import { FilePicker } from './FilePicker'
import { useEscape } from './useEscape'
import { fmtExact } from './usage'

// OD-73: the project view. A project is a working folder; this manages its name/description, its instructions (the OD-41
// Projektnotiz, edited in its own dialog) and its knowledge — reference files/text that OpenDante prepends to every
// prompt in the project, or, once it outgrows the model's window, searches locally (RAG). The capacity bar shows how much
// of the context window the knowledge uses, and whether it is loaded whole or searched.
const RAG_BUDGET = 16000 // tokens of knowledge loaded in full before local search takes over (matches the companion)

export function ProjectPanel({ open, dir, instructions, onClose, onOpenInstructions, onChanged }: {
  open: boolean
  dir: string
  instructions: string
  onClose: () => void
  onOpenInstructions: () => void
  onChanged?: () => void
}) {
  const [meta, setMeta] = useState<ProjectMeta>({ name: '', description: '', createdAt: null })
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [kTokens, setKTokens] = useState(0)
  const [fpOpen, setFpOpen] = useState(false)
  const [textAdd, setTextAdd] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const reload = useCallback(async () => {
    if (!dir) return
    const [m, k] = await Promise.all([getProjectMeta(dir), getKnowledge(dir)])
    setMeta(m); setItems(k.items); setKTokens(k.tokens)
  }, [dir])
  useEffect(() => { if (open && dir) { setErr(''); setTextAdd(null); void reload() } }, [open, dir, reload])
  useEscape(open, onClose)
  if (!open) return null

  const guard = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('')
    try { await fn(); await reload(); onChanged?.() } catch (e) { setErr(String((e as Error).message || e)) } finally { setBusy(false) }
  }
  const addFiles = (files: { path: string; name: string }[]) => guard(async () => { for (const f of files) await addKnowledge(dir, { srcPath: f.path }) })
  const addText = () => guard(async () => { await addKnowledge(dir, { content: textAdd || '' }); setTextAdd(null) })
  const instrTokens = Math.round(instructions.trim().length / 4)
  const totalTokens = kTokens + instrTokens
  const searching = kTokens > RAG_BUDGET
  const pct = Math.min(100, Math.round((kTokens / RAG_BUDGET) * 100))
  const winPct = Math.round((totalTokens / CONTEXT_LIMIT) * 100)

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-[620px] flex-col rounded-2xl border border-line bg-panel" onClick={(e) => e.stopPropagation()} data-testid="project-panel">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-ink3">📁 Projekt</div>
            {dir ? (
              <input className="mt-0.5 w-full rounded-md border border-transparent bg-transparent text-[16px] font-semibold text-ink outline-none hover:border-line focus:border-accent"
                value={meta.name} onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))}
                onBlur={() => { if (meta.name.trim()) void guard(() => saveProjectMeta(dir, { name: meta.name.trim() })) }}
                data-testid="project-name" aria-label="Projektname" />
            ) : <div className="mt-0.5 text-[16px] font-semibold">Kein Projekt gewählt</div>}
            <div className="mono mt-0.5 truncate text-[11px] text-ink3" title={dir}>{dir || '—'}</div>
          </div>
          <button className="shrink-0 rounded-md px-2 py-1 text-ink3 hover:bg-user hover:text-ink2" onClick={onClose} aria-label="Schließen" title="Schließen (Esc)" data-testid="project-close">✕</button>
        </div>

        {!dir ? (
          <div className="px-5 py-8 text-center text-[13px] text-ink3" data-testid="project-none">
            Der Standard-Serverordner ist kein Projekt. Wähle über <b>„+ → Ordner hinzufügen"</b> einen Projektordner — dann hat er Name, Anweisungen und eigenes Wissen.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {/* Beschreibung (nur für Menschen, das Modell sieht sie nicht). */}
            <textarea className="w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink2 outline-none placeholder:text-ink3 focus:border-accent/60"
              rows={2} placeholder="Kurze Beschreibung (nur für dich, das Modell sieht sie nicht)…" value={meta.description}
              onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))}
              onBlur={() => void guard(() => saveProjectMeta(dir, { description: meta.description }))} data-testid="project-desc" />

            {/* Anweisungen (= Projektnotiz, OD-41): gelten automatisch in jedem Chat dieses Projekts. */}
            <div className="mt-4 flex items-center justify-between">
              <div className="text-[13px] font-semibold text-ink">Anweisungen</div>
              <button className="rounded-md border border-line px-2 py-1 text-[12px] text-ink2 hover:bg-user" onClick={onOpenInstructions} data-testid="project-edit-instructions">Bearbeiten</button>
            </div>
            <div className="mt-1 rounded-lg border border-line bg-bg px-3 py-2 text-[12px] text-ink3" data-testid="project-instructions">
              {instructions.trim() ? <span className="line-clamp-3 whitespace-pre-wrap">{instructions.trim().slice(0, 240)}{instructions.trim().length > 240 ? '…' : ''}</span>
                : <span>Noch keine. Gelten automatisch in jedem Chat dieses Projekts (Ton, Rolle, Konventionen …).</span>}
            </div>

            {/* Projektwissen + Kapazitätsbalken. */}
            <div className="mt-4 flex items-center justify-between">
              <div className="text-[13px] font-semibold text-ink">Projektwissen</div>
              <div className="flex gap-2">
                <button className="rounded-md border border-line px-2 py-1 text-[12px] text-ink2 hover:bg-user disabled:opacity-40" disabled={busy} onClick={() => { setTextAdd(''); }} data-testid="project-add-text">+ Text</button>
                <button className="rounded-md border border-line px-2 py-1 text-[12px] text-ink2 hover:bg-user disabled:opacity-40" disabled={busy} onClick={() => setFpOpen(true)} data-testid="project-add-file">+ Datei</button>
              </div>
            </div>
            <div className="mt-1.5" data-testid="project-capacity" title={`${fmtExact(totalTokens)} von ${fmtExact(CONTEXT_LIMIT)} Tokens Kontextfenster (Wissen + Anweisungen)`}>
              <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-line">
                <span className={`h-full ${searching ? 'bg-sky-400' : pct > 85 ? 'bg-amber-400' : 'bg-accent'}`} style={{ width: `${searching ? 100 : pct}%` }} />
              </div>
              <div className="mt-1 text-[11px] text-ink3">
                {searching
                  ? <>Projektwissen: <b className="text-sky-400">{fmtExact(kTokens)} Tokens</b> — größer als das Fenster, OpenDante <b>durchsucht</b> es pro Frage (lokale Suche) und legt nur die passenden Teile bei.</>
                  : <>Projektwissen: <b>{fmtExact(kTokens)} Tokens</b> ({winPct} % des Fensters) — passt ganz hinein und wird jeder Nachricht beigelegt.</>}
              </div>
            </div>

            {textAdd !== null && (
              <div className="mt-2" data-testid="project-text-box">
                <textarea autoFocus className="w-full resize-none rounded-lg border border-accent/50 bg-bg px-3 py-2 text-[13px] outline-none" rows={4}
                  placeholder="Text als Wissen einfügen (z. B. Richtlinien, Fakten, ein Auszug)…" value={textAdd} onChange={(e) => setTextAdd(e.target.value)} data-testid="project-text-input" />
                <div className="mt-1 flex justify-end gap-2">
                  <button className="rounded-md border border-line px-2.5 py-1 text-[12px] text-ink3 hover:bg-user" onClick={() => setTextAdd(null)}>Abbrechen</button>
                  <button className="btn-accent !py-1 !text-[12px] disabled:opacity-40" disabled={busy || !textAdd.trim()} onClick={addText} data-testid="project-text-save">Hinzufügen</button>
                </div>
              </div>
            )}

            {err && <div className="mt-2 text-[12px] text-amber-400/90" data-testid="project-err">{err}</div>}

            <ul className="mt-2 flex flex-col gap-1.5" data-testid="project-knowledge-list">
              {items.length === 0 ? (
                <li className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink3" data-testid="project-knowledge-empty">
                  Noch kein Wissen. Füge Textdateien, Notizen oder Code-Ausschnitte hinzu — sie stehen dann in jedem Chat dieses Projekts bereit.
                </li>
              ) : items.map((it) => (
                <li key={it.id} className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2" data-testid="project-knowledge-item">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={it.name}>📄 {it.name}</span>
                  <span className="shrink-0 text-[11px] text-ink3">{fmtExact(Math.round(it.chars / 4))} Tok.</span>
                  <button className="shrink-0 rounded-md px-1.5 py-0.5 text-ink3 hover:bg-line hover:text-ink2" onClick={() => void guard(() => removeKnowledge(dir, it.id))} aria-label={`${it.name} entfernen`} data-testid="project-knowledge-remove">✕</button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-ink3">Nur Textdateien (txt, md, csv, json, Code …) — Bilder/PDF kommen später. Wissen bleibt lokal im Projektordner.</p>
          </div>
        )}
        <FilePicker open={fpOpen} onClose={() => setFpOpen(false)} onPick={(files) => { setFpOpen(false); addFiles(files) }} />
      </div>
    </div>
  )
}
