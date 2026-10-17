import { useEffect, useRef, useState } from 'react'
import { CLAUDE_MODELS, LOCAL_MODELS, effortLevels, useSettings } from './settings'
import { COMPANION, OFFLINE_HINT, companionPost } from './companion'
import { useSkills } from './skills'
import { cloneRepo, gitAction, useProjects } from './projects'
import { useChats } from './chats'
import { UsageOverview } from './UsageOverview'
import { useEscape } from './useEscape'

// Pull the skill name from the SKILL.md front-matter (`name:` in the --- head); fall back to the file name.
export function skillNameFrom(content: string, fileName: string): string {
  const m = content.match(/^\s*---[\s\S]*?\bname:\s*["']?([^"'\n]+)/)
  if (m) return m[1].trim()
  return fileName.replace(/\.(md|markdown)$/i, '').trim()
}

// The "Einstellungen" panel: global instructions, the Claude API connection (key, model, auto/manual), connectors
// (placeholder), saving skills, and the two update buttons. Global instructions take effect immediately (prepended to
// every prompt). The rest reaches the system through the local helper service; until it runs, those actions say so.
export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings()
  const skills = useSkills()
  const projects = useProjects()
  const chats = useChats()
  const [status, setStatus] = useState('')
  const [skill, setSkill] = useState({ name: '', content: '' })
  const [repoUrl, setRepoUrl] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const [gitOut, setGitOut] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [spentToday, setSpentToday] = useState<number | null>(null)
  const [claudeTest, setClaudeTest] = useState('')

  // Refresh the installed skills, cloned projects, chat totals and today's Claude spend whenever the panel opens.
  useEffect(() => {
    if (!open) return
    void skills.refresh(); void projects.refresh(); void chats.refresh()
    fetch(COMPANION + '/claude/usage').then((r) => r.json()).then((u) => setSpentToday(typeof u.usd === 'number' ? u.usd : null)).catch(() => setSpentToday(null))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEscape(open, onClose)

  if (!open) return null

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setStatus(`${label}…`)
    try { await fn(); setStatus(`✓ ${label}`) } catch { setStatus(`${label}: ${OFFLINE_HINT}`) }
  }

  // Clone (or update) a GitHub project and make it the agent's working folder.
  const doClone = async () => {
    setStatus('Projekt wird geladen…'); setGitOut('')
    try {
      const r = await cloneRepo(repoUrl)
      if (!r.ok) { setStatus('Klonen fehlgeschlagen'); setGitOut(r.err || r.out || ''); return }
      await projects.refresh()
      s.set({ workdir: r.path })
      setStatus(`✓ „${r.name}" ${r.updated ? 'aktualisiert' : 'geklont'} und als Arbeitsordner gesetzt`)
      setRepoUrl('')
    } catch { setStatus(OFFLINE_HINT) }
  }

  // Run a git action in the active working folder and show its output.
  const doGit = async (action: 'status' | 'commit' | 'push' | 'pull', message?: string) => {
    setStatus(`Git: ${action}…`); setGitOut('')
    try {
      const r = await gitAction(s.workdir, action, message)
      setStatus(r.code === 0 ? `✓ Git ${action} erledigt` : `Git ${action}: Fehler`)
      setGitOut([r.out, r.err].filter(Boolean).join('\n') || '(keine Ausgabe)')
      if (action === 'commit' && r.code === 0) setCommitMsg('')
    } catch { setStatus(OFFLINE_HINT) }
  }

  // Read one or more chosen .md files and save each as a skill at once — no copy/paste needed.
  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (e.target) e.target.value = '' // allow re-picking the same file later
    if (!files.length) return
    const saved: string[] = []
    try {
      setStatus(files.length > 1 ? `${files.length} Skills werden gespeichert…` : 'Skill wird gespeichert…')
      for (const file of files) {
        const content = await file.text()
        const name = skillNameFrom(content, file.name)
        await companionPost('/skills', { name, content })
        saved.push(name)
      }
      setStatus(`✓ gespeichert: ${saved.join(', ')}`)
    } catch {
      setStatus(saved.length ? `teilweise gespeichert (${saved.join(', ')}); Rest: ${OFFLINE_HINT}` : OFFLINE_HINT)
    }
    void skills.refresh()
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-[620px] flex-col overflow-y-auto rounded-2xl border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()} data-testid="settings">
        <div className="mb-4 text-[17px] font-semibold">Einstellungen</div>

        {/* Totals: local vs Claude over all saved chats */}
        <Section title="Übersicht: lokal statt Claude" hint="Über alle Chats im Verlauf: wie viel an Claude ausgelagert wurde und wie viele Claude-Tokens dein PC eingespart hat.">
          <UsageOverview chats={chats.list} loaded={chats.loaded} />
        </Section>

        {/* Global instructions */}
        <Section title="Globale Anweisungen" hint="Gelten für jede Unterhaltung — wie die persönlichen Anweisungen bei Claude.">
          <textarea className="min-h-[72px] w-full rounded-lg border border-line bg-bg p-2 text-[14px] outline-none"
            placeholder="z. B. Antworte knapp. Schreibe Kommentare auf Deutsch. Nutze immer Tests."
            value={s.globalInstructions} onChange={(e) => s.set({ globalInstructions: e.target.value })} data-testid="global-instructions" />
        </Section>

        {/* Local model */}
        <Section title="Lokales Modell" hint="Das Modell auf deiner Grafikkarte, mit dem OpenDante arbeitet. „Uncensored“ ist dasselbe Qwen-Modell ohne eingebaute Ablehnungen. Ein neu gewähltes Modell einmal mit „Modelle aktualisieren“ (unten) herunterladen.">
          <select className="w-full rounded-lg border border-line bg-bg p-2 text-[14px] outline-none" value={s.localModel} onChange={(e) => s.set({ localModel: e.target.value })} data-testid="local-model">
            {LOCAL_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.note}</option>)}
          </select>
          <div className="mono mt-1.5 break-all text-[12px] text-ink3">{s.localModel}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-ink3">Nach der letzten Antwort geladen halten:</span>
            <select className="rounded-lg border border-line bg-bg p-1.5 text-[13px] outline-none" value={s.keepWarmMin}
              onChange={(e) => s.set({ keepWarmMin: Number(e.target.value) })} data-testid="keep-warm">
              <option value={0}>5 Minuten (Ollama-Standard)</option>
              <option value={30}>30 Minuten</option>
              <option value={60}>1 Stunde</option>
              <option value={120}>2 Stunden</option>
            </select>
          </div>
          <p className="mt-1 text-[12px] text-ink3">
            Spart nach einer Pause ~45 s Ladezeit vor der ersten Antwort. Das Modell belegt solange ~18 GB Grafikspeicher; OpenDali entlädt es beim Start automatisch.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-ink3">Aufwand (Nachdenken) beim Umsetzen:</span>
            <select className="rounded-lg border border-line bg-bg p-1.5 text-[13px] outline-none" data-testid="settings-effort"
              value={effortLevels(s.localModel).some((l) => l.key === s.effort) ? s.effort : effortLevels(s.localModel)[0].key}
              onChange={(e) => s.set({ effort: e.target.value })}>
              {effortLevels(s.localModel).map((l) => <option key={l.key} value={l.key}>{l.label}{l.hint ? ` — ${l.hint}` : ''}</option>)}
            </select>
          </div>
          <p className="mt-1 text-[12px] text-ink3">
            Auch direkt unter der Eingabe wählbar. Die Stufen hängen vom Modell ab: das Standardmodell (zensurfrei) kann nur „Schnell“ (ohne Nachdenken) und „Gründlich“ (mit) — gemessen an 6 schweren Aufgaben je zweimal: ohne 12/12 in 74 min, mit 11/12 in 167 min. Das Original-Qwen hat zusätzlich Niedrig/Mittel/Hoch. Ein Plan („Erst planen“) wird immer gründlich durchdacht.
          </p>
        </Section>

        {/* Claude API */}
        <Section title="Claude-Verbindung (API)" hint="Einmalig deinen Anthropic-Schlüssel eintragen und speichern. Danach laufen die Modi „Mit Claude beschleunigen“ und „Claude-Audit“ automatisch — ohne Eingabe pro Aufgabe. Die Aufrufe kosten API-Gebühren.">
          <input type="password" className="w-full rounded-lg border border-line bg-bg p-2 text-[14px] outline-none"
            placeholder="Anthropic API-Schlüssel (sk-ant-…)" value={s.apiKey} onChange={(e) => s.set({ apiKey: e.target.value })} data-testid="api-key" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-ink3">Modell:</span>
            <select className="rounded-lg border border-line bg-bg p-2 text-[14px] outline-none" value={s.claudeModel} onChange={(e) => s.set({ claudeModel: e.target.value })} data-testid="claude-model">
              {CLAUDE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.note}</option>)}
            </select>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-ink3">Tageslimit:</span>
            <input type="number" min={0} step={0.5} className="w-24 rounded-lg border border-line bg-bg p-1.5 text-[13px] outline-none"
              value={s.claudeDailyUsd} onChange={(e) => s.set({ claudeDailyUsd: Math.max(0, Number(e.target.value) || 0) })} data-testid="claude-cap" />
            <span className="text-ink3">US-Dollar pro Tag (0 = kein Limit)</span>
            {spentToday != null && <span className="text-ink2" data-testid="claude-spent">· heute verbraucht: {spentToday.toFixed(2)} $</span>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn-accent" onClick={() => run('Claude-Zugang gespeichert', () => companionPost('/settings', { globalInstructions: s.globalInstructions, apiKey: s.apiKey, claudeModel: s.claudeModel }))} data-testid="save-claude">Speichern</button>
            <button className="rounded-lg border border-line px-3 py-1.5 text-[14px] text-ink2 hover:bg-user" data-testid="test-claude"
              onClick={async () => {
                setClaudeTest('Teste Verbindung …')
                try {
                  await companionPost('/settings', { globalInstructions: s.globalInstructions, apiKey: s.apiKey, claudeModel: s.claudeModel })
                  const r = await companionPost<{ ok: boolean; model?: string; error?: string }>('/claude/test', { model: s.claudeModel })
                  setClaudeTest(r.ok ? `✓ Verbindung ok (${r.model})` : `✗ ${r.error || 'Fehlgeschlagen'}`)
                } catch { setClaudeTest(`✗ ${OFFLINE_HINT}`) }
              }}>Verbindung testen</button>
            {claudeTest && <span className={`text-[13px] ${claudeTest.startsWith('✓') ? 'text-emerald-400' : claudeTest.startsWith('✗') ? 'text-red-400' : 'text-ink2'}`} role="status">{claudeTest}</span>}
          </div>
        </Section>

        {/* Projects (GitHub) */}
        <Section title="Projekte (GitHub)" hint="Verbinde ein GitHub-Projekt: OpenDante lädt es herunter (klont es) und arbeitet darin. Zum Bearbeiten brauchst du nur das. „Push“ lädt deine Änderungen zurück zu GitHub (beim ersten Mal fragt Windows nach deinem GitHub-Login).">
          <div className="flex gap-2">
            <input className="flex-1 rounded-lg border border-line bg-bg p-2 text-[14px] outline-none" placeholder="https://github.com/benutzer/projekt" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} data-testid="repo-url" />
            <button className="btn-accent shrink-0" disabled={!repoUrl.trim()} onClick={doClone} data-testid="clone-repo">Klonen / Verbinden</button>
          </div>

          <div className="mt-3 rounded-lg border border-line bg-bg p-2" data-testid="repo-list">
            <div className="mb-1 text-[12px] uppercase tracking-wider text-ink3">Deine Projekte</div>
            {projects.list.length === 0
              ? <div className="px-1 py-1 text-[13px] text-ink3">{projects.loaded ? 'Noch keine Projekte verbunden.' : 'Wird geladen…'}</div>
              : <ul className="flex flex-col gap-1">
                  {projects.list.map((r) => (
                    <li key={r.path} className="flex items-center justify-between gap-2 rounded-md px-2 py-1">
                      <div className="min-w-0">
                        <div className="text-[13px] text-ink2">{r.name}{s.workdir === r.path && <span className="ml-2 text-[12px] text-accent">● aktiv</span>}</div>
                        <div className="mono break-all text-[11px] text-ink3">{r.path}</div>
                      </div>
                      <button className="shrink-0 rounded-md border border-line px-2 py-1 text-[12px] text-ink2 hover:bg-user" onClick={() => s.set({ workdir: r.path })}>Als Arbeitsordner</button>
                    </li>
                  ))}
                </ul>}
          </div>

          {s.workdir && (
            <div className="mt-3">
              <div className="text-[12px] text-ink3">Aktiver Ordner: <span className="mono break-all text-ink2">{s.workdir}</span></div>
              <input className="mt-2 w-full rounded-lg border border-line bg-bg p-2 text-[14px] outline-none" placeholder="Commit-Nachricht (was wurde geändert?)" value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} data-testid="commit-msg" />
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn-accent" disabled={!commitMsg.trim()} onClick={() => doGit('commit', commitMsg)} data-testid="git-commit">Committen</button>
                <button className="rounded-lg border border-line px-3 py-1.5 text-[14px] text-ink2 hover:bg-user" onClick={() => doGit('push')} data-testid="git-push">Push zu GitHub</button>
                <button className="rounded-lg border border-line px-3 py-1.5 text-[14px] text-ink2 hover:bg-user" onClick={() => doGit('status')} data-testid="git-status">Status</button>
                <button className="rounded-lg border border-line px-3 py-1.5 text-[14px] text-ink2 hover:bg-user" onClick={() => doGit('pull')} data-testid="git-pull">Pull</button>
              </div>
            </div>
          )}
          {gitOut && <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-2 text-[12px] text-ink2">{gitOut}</pre>}
        </Section>

        {/* Connectors (placeholder) */}
        <Section title="Connectoren" hint="Bald: Browser, Datenbank u. a. über MCP anbinden.">
          <button className="rounded-lg border border-dashed border-line px-3 py-1.5 text-[13px] text-ink3" disabled>+ Connector hinzufügen</button>
        </Section>

        {/* Skills */}
        <Section title="Skills" hint="Speichere eigene Skills (SKILL.md). Im Chat rufst du sie mit /name auf — oder per Klick in der Seitenleiste. Deine Claude-Code-Skills passen unverändert.">
          <input ref={fileRef} type="file" accept=".md,.markdown,text/markdown" multiple className="hidden" onChange={onPickFile} data-testid="skill-file" />
          <button className="btn-accent" onClick={() => fileRef.current?.click()} data-testid="upload-skill">↑ SKILL.md-Dateien hochladen</button>
          <p className="mt-1.5 text-[12px] text-ink3">Mehrere <span className="mono">.md</span>-Dateien auf einmal möglich — der Name wird aus dem Kopf jeder Datei übernommen und sofort gespeichert. Oder unten von Hand eintragen.</p>

          {/* Installed skills */}
          <div className="mt-3 rounded-lg border border-line bg-bg p-2" data-testid="skill-list">
            <div className="mb-1 text-[12px] uppercase tracking-wider text-ink3">Installierte Skills</div>
            {skills.list.length === 0
              ? <div className="px-1 py-1 text-[13px] text-ink3">{skills.loaded ? 'Noch keine Skills installiert.' : 'Wird geladen…'}</div>
              : <ul className="flex flex-col gap-1">
                  {skills.list.map((sk) => (
                    <li key={sk.slug} className="rounded-md px-2 py-1">
                      <div className="flex items-baseline gap-2">
                        <span className="mono text-[13px] text-accent">/{sk.slug}</span>
                        <span className="text-[13px] text-ink2">{sk.name}</span>
                      </div>
                      {sk.description && <div className="text-[12px] text-ink3 line-clamp-2">{sk.description}</div>}
                    </li>
                  ))}
                </ul>}
          </div>

          <input className="mt-3 w-full rounded-lg border border-line bg-bg p-2 text-[14px] outline-none" placeholder="Name (z. B. test-runner)" value={skill.name} onChange={(e) => setSkill({ ...skill, name: e.target.value })} />
          <textarea className="mt-2 min-h-[72px] w-full rounded-lg border border-line bg-bg p-2 font-mono text-[12px] outline-none" placeholder="Inhalt der SKILL.md (mit --- Kopf ---)…" value={skill.content} onChange={(e) => setSkill({ ...skill, content: e.target.value })} />
          <button className="btn-accent mt-2" disabled={!skill.name.trim() || !skill.content.trim()} onClick={() => run('Skill gespeichert', async () => { await companionPost('/skills', skill); await skills.refresh() })} data-testid="save-skill">Skill speichern</button>
        </Section>

        {/* Updates */}
        <Section title="Updates" hint="Holt die neueste Version bzw. die neuesten Modelle — wie bei OpenDali. Nach einem App-Update OpenDante einmal neu starten (Fenster schließen und Desktop-Symbol erneut öffnen), damit die neue Version vollständig greift.">
          <div className="flex flex-wrap gap-2">
            <button className="btn-accent" onClick={() => run('OpenDante aktualisiert — bitte neu starten', () => companionPost('/update/app'))} data-testid="update-app">OpenDante aktualisieren (GitHub)</button>
            <button className="rounded-lg border border-line px-3 py-1.5 text-[14px] text-ink2 hover:bg-user" onClick={() => run('Modell-Download gestartet (dauert einige Minuten)', () => companionPost('/update/models', { model: s.localModel }))} data-testid="update-models">Modelle aktualisieren</button>
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

