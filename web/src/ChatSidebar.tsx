import { type RefObject, useState } from 'react'
import { type ChatMeta, filterChats } from './chats'
import type { SkillInfo } from './skills'
import { localModelName } from './settings'
import { HistoryItem } from './HistoryItem'

const SEARCH_FROM = 7 // show the Verlauf search box only once the list is long enough to need it (OD-62)

// The left column. State and effects stay in App; this only draws them and calls back (the names match the ones in App).
export function ChatSidebar({ running, stopRun, startNewChat, setModiOpen, modesActive, setSettingsOpen, chats, activeChat, openChat, historyMsg, skills, setInput, inputRef, modes, online }: {
  running: boolean; stopRun: () => Promise<void>; startNewChat: () => void
  setModiOpen: (open: boolean) => void; modesActive: number; setSettingsOpen: (open: boolean) => void
  chats: { list: ChatMeta[]; loaded: boolean; rename: (id: string, title: string) => Promise<void>; remove: (id: string) => Promise<void> }
  activeChat: string | null; openChat: (id: string) => Promise<void>; historyMsg: string
  skills: { list: SkillInfo[]; loaded: boolean }
  setInput: (text: string) => void; inputRef: RefObject<HTMLTextAreaElement | null>
  modes: { workdir: string; localModel: string }
  online: boolean | null
}) {
  const [query, setQuery] = useState('')
  const shown = filterChats(chats.list, query) // OD-62: title search, client-side
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="size-3 rounded-full bg-accent" />
        <span className="text-[15px] font-semibold tracking-tight">OpenDante</span>
      </div>
      <button className="mx-3 rounded-lg border border-line px-3 py-2 text-left text-[14px] text-ink2 hover:bg-user"
        onClick={() => { if (running) void stopRun(); startNewChat() }} data-testid="new-chat">+ Neuer Chat</button>
      <button className="mx-3 mb-3 mt-2 flex items-center justify-between rounded-lg border border-line px-3 py-2 text-left text-[14px] text-ink2 hover:bg-user"
        onClick={() => setModiOpen(true)} data-testid="open-modi">
        <span>Modi</span>
        {modesActive > 0 && <span className="rounded-full bg-accent/20 px-2 text-[12px] text-accent">{modesActive} an</span>}
      </button>
      <button className="mx-3 mb-3 rounded-lg border border-line px-3 py-2 text-left text-[14px] text-ink2 hover:bg-user"
        onClick={() => setSettingsOpen(true)} data-testid="open-settings">Einstellungen</button>
      <div className="px-4 py-1 text-[11px] uppercase tracking-wider text-ink3">Verlauf</div>
      {chats.list.length >= SEARCH_FROM && (
        <div className="relative mx-3 mb-1">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Verlauf durchsuchen…"
            className="w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 pr-7 text-[13px] text-ink2 outline-none placeholder:text-ink3 focus:border-accent/60"
            data-testid="history-search" aria-label="Verlauf durchsuchen" />
          {query && <button className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-ink3 hover:text-ink2" onClick={() => setQuery('')} aria-label="Suche löschen" title="Suche löschen" data-testid="history-search-clear">✕</button>}
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-3 text-[13px]" data-testid="history">
        {chats.list.length === 0 ? (
          <p className="px-1 py-2 text-ink3">{chats.loaded ? 'Noch keine Unterhaltungen.' : '…'}</p>
        ) : shown.length === 0 ? (
          <p className="px-1 py-2 text-ink3" data-testid="history-empty">Keine Treffer für „{query.trim()}".</p>
        ) : (
          <div className="flex flex-col gap-0.5 pb-2">
            {shown.map((c) => (
              <HistoryItem key={c.id} c={c} active={c.id === activeChat} disabled={running && c.id !== activeChat}
                onOpen={() => void openChat(c.id)}
                onRename={(title) => void chats.rename(c.id, title)}
                onDelete={() => { if (c.id === activeChat) startNewChat(); void chats.remove(c.id) }} />
            ))}
          </div>
        )}
        {historyMsg && <p className="px-1 py-1 text-[12px] text-accent">{historyMsg}</p>}
      </div>
      <div className="border-t border-line px-4 py-3">
        <div className="text-[11px] uppercase tracking-wider text-ink3">Skills</div>
        {skills.list.length === 0 ? (
          <p className="mt-1 text-[13px] text-ink3">{skills.loaded ? 'Noch keine — über Einstellungen hochladen.' : '…'}</p>
        ) : (
          <div className="mt-1 flex flex-col gap-0.5">
            {skills.list.map((sk) => (
              <button key={sk.slug} className="rounded-md px-1.5 py-1 text-left text-[13px] text-ink2 hover:bg-user" title={sk.description || sk.name}
                onClick={() => { setInput(`/${sk.slug} `); inputRef.current?.focus() }} data-testid={`skill-${sk.slug}`}>
                <span className="mono text-accent">/{sk.slug}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-line px-4 py-2 text-[12px] text-ink3" title={modes.workdir || 'Der Ordner, in dem OpenCode gestartet wurde'}>
        <span className="uppercase tracking-wider">Ordner</span>
        <div className="mono mt-0.5 break-all text-ink2">{modes.workdir || 'Standard (Serverordner)'}</div>
      </div>
      <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[12px] text-ink2">
        <span className="min-w-0 truncate" title={modes.localModel}><span className="mono">{localModelName(modes.localModel)}</span> · lokal</span>
        <span className="inline-flex items-center gap-1.5" title={online ? 'verbunden' : 'Server nicht erreichbar'}>
          <span className={`size-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-ink3'}`} />
          {online === null ? '…' : online ? 'bereit' : 'offline'}
        </span>
      </div>
    </aside>
  )
}
