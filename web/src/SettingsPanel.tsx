import { useState } from 'react'
import { CLAUDE_MODELS, useSettings } from './settings'
import { OFFLINE_HINT, companionPost } from './companion'

// The "Einstellungen" panel: global instructions, the Claude API connection (key, model, auto/manual), connectors
// (placeholder), saving skills, and the two update buttons. Global instructions take effect immediately (prepended to
// every prompt). The rest reaches the system through the local helper service; until it runs, those actions say so.
export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings()
  const [status, setStatus] = useState('')
  const [skill, setSkill] = useState({ name: '', content: '' })
  if (!open) return null

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setStatus(`${label}…`)
    try { await fn(); setStatus(`✓ ${label}`) } catch { setStatus(`${label}: ${OFFLINE_HINT}`) }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-[620px] flex-col overflow-y-auto rounded-2xl border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()} data-testid="settings">
        <div className="mb-4 text-[17px] font-semibold">Einstellungen</div>

        {/* Global instructions */}
        <Section title="Globale Anweisungen" hint="Gelten für jede Unterhaltung — wie die persönlichen Anweisungen bei Claude.">
          <textarea className="min-h-[72px] w-full rounded-lg border border-line bg-bg p-2 text-[14px] outline-none"
            placeholder="z. B. Antworte knapp. Schreibe Kommentare auf Deutsch. Nutze immer Tests."
            value={s.globalInstructions} onChange={(e) => s.set({ globalInstructions: e.target.value })} data-testid="global-instructions" />
        </Section>

        {/* Claude API */}
        <Section title="Claude-Verbindung (API)" hint="Für die Modi zum Auslagern an Claude und fürs Audit. Kostet Geld — nur bei Automatisch und aktiviertem Modus.">
          <input type="password" className="w-full rounded-lg border border-line bg-bg p-2 text-[14px] outline-none"
            placeholder="Anthropic API-Schlüssel (sk-ant-…)" value={s.apiKey} onChange={(e) => s.set({ apiKey: e.target.value })} data-testid="api-key" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select className="rounded-lg border border-line bg-bg p-2 text-[14px] outline-none" value={s.claudeModel} onChange={(e) => s.set({ claudeModel: e.target.value })} data-testid="claude-model">
              {CLAUDE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.note}</option>)}
            </select>
          </div>
          <div className="mt-2 flex gap-2">
            <Choice on={!s.claudeAuto} onClick={() => s.set({ claudeAuto: false })}>Manuell (Kopieren/Einfügen, kostenlos)</Choice>
            <Choice on={s.claudeAuto} onClick={() => s.set({ claudeAuto: true })}>Automatisch (API, kostet Geld)</Choice>
          </div>
          <button className="btn-accent mt-3" onClick={() => run('Claude-Zugang gespeichert', () => companionPost('/settings', { globalInstructions: s.globalInstructions, apiKey: s.apiKey, claudeModel: s.claudeModel, claudeAuto: s.claudeAuto }))} data-testid="save-claude">Speichern</button>
        </Section>

        {/* Connectors (placeholder) */}
        <Section title="Connectoren" hint="Bald: Browser, Datenbank, GitHub u. a. über MCP anbinden.">
          <button className="rounded-lg border border-dashed border-line px-3 py-1.5 text-[13px] text-ink3" disabled>+ Connector hinzufügen</button>
        </Section>

        {/* Skills */}
        <Section title="Skills" hint="Speichere eigene Skills (SKILL.md). Sie lassen sich über den Chat auslösen. Deine Claude-Code-Skills passen unverändert.">
          <input className="w-full rounded-lg border border-line bg-bg p-2 text-[14px] outline-none" placeholder="Name (z. B. test-runner)" value={skill.name} onChange={(e) => setSkill({ ...skill, name: e.target.value })} />
          <textarea className="mt-2 min-h-[72px] w-full rounded-lg border border-line bg-bg p-2 font-mono text-[12px] outline-none" placeholder="Inhalt der SKILL.md (mit --- Kopf ---)…" value={skill.content} onChange={(e) => setSkill({ ...skill, content: e.target.value })} />
          <button className="btn-accent mt-2" disabled={!skill.name.trim() || !skill.content.trim()} onClick={() => run('Skill gespeichert', () => companionPost('/skills', skill))} data-testid="save-skill">Skill speichern</button>
        </Section>

        {/* Updates */}
        <Section title="Updates" hint="Holt die neueste Version bzw. die neuesten Modelle — wie bei OpenDali.">
          <div className="flex flex-wrap gap-2">
            <button className="btn-accent" onClick={() => run('OpenDante aktualisiert', () => companionPost('/update/app'))} data-testid="update-app">OpenDante aktualisieren (GitHub)</button>
            <button className="rounded-lg border border-line px-3 py-1.5 text-[14px] text-ink2 hover:bg-user" onClick={() => run('Modelle aktualisiert', () => companionPost('/update/models'))} data-testid="update-models">Modelle aktualisieren</button>
          </div>
        </Section>

        {status && <div className="mt-1 text-[13px] text-ink2" role="status">{status}</div>}
        <div className="mt-4 text-right"><button className="btn-accent" onClick={onClose}>Fertig</button></div>
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-4 first:border-t-0 first:pt-0">
      <div className="text-[14px] font-medium">{title}</div>
      <div className="mb-2 mt-0.5 text-[13px] text-ink3">{hint}</div>
      {children}
    </section>
  )
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-lg border px-3 py-1.5 text-[13px] ${on ? 'border-accent bg-accent/15 text-ink' : 'border-line text-ink2 hover:bg-user'}`}>{children}</button>
  )
}
