import { create } from 'zustand'
import { COMPANION, companionPost } from './companion'
import type { ChatUsage } from './usage'

// The Verlauf: every chat is saved by the companion (files under ~/.opendante/chats) after each answer, and can be
// reopened from the sidebar. A reopened chat continues in the same OpenCode session, so the model keeps its context.

export interface ChatMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  workdir: string
  model: string
  messages: number
  usage: Partial<ChatUsage>
}

export interface SavedChat<M = unknown> {
  id: string
  title: string
  createdAt: number
  workdir: string
  model: string
  sessionId: string | null
  messages: M[]
  usage: ChatUsage
}

/** A fresh chat id: time-sortable and only [a-z0-9-] (the companion checks that before using it as a file name). */
export const newChatId = (): string => `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** The chat's title: its first request, on one line, at most 60 characters. */
export function chatTitle(firstPrompt: string): string {
  const one = firstPrompt.replace(/\s+/g, ' ').trim()
  return one.length > 60 ? `${one.slice(0, 59).trimEnd()}…` : one || 'Neuer Chat'
}

/** OD-62: filter the Verlauf by a free-text query — case-insensitive substring of the chat title. Empty query → all. */
export function filterChats<T extends { title: string }>(list: T[], q: string): T[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return list
  return list.filter((c) => c.title.toLowerCase().includes(needle))
}

/** OD-73: one project group in the Verlauf — a working folder, its display name, and its chats. */
export interface ChatGroup { dir: string; name: string; chats: ChatMeta[] }
const projBase = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
/** Group chats by their project (workdir). Active project first, other projects by most-recent chat, "Ohne Projekt" last. */
export function groupChats(chats: ChatMeta[], names: Record<string, string>, activeDir: string): ChatGroup[] {
  const by = new Map<string, ChatMeta[]>()
  for (const c of chats) { const d = c.workdir || ''; const arr = by.get(d) ?? []; arr.push(c); by.set(d, arr) }
  const groups: ChatGroup[] = [...by.entries()].map(([dir, cs]) => ({ dir, name: dir ? (names[dir] || projBase(dir)) : 'Ohne Projekt', chats: cs }))
  return groups.sort((a, b) => {
    if (a.dir && a.dir === activeDir) return -1
    if (b.dir && b.dir === activeDir) return 1
    if (!a.dir) return 1
    if (!b.dir) return -1
    return (b.chats[0]?.updatedAt || 0) - (a.chats[0]?.updatedAt || 0)
  })
}

/** "vor 5 Min." / "gestern" / "12.10." — short German relative date for the Verlauf list. */
export function relDate(ts: number, now = Date.now()): string {
  const min = Math.floor((now - ts) / 60000)
  if (min < 1) return 'gerade eben'
  if (min < 60) return `vor ${min} Min.`
  const d = new Date(ts), n = new Date(now)
  if (d.toDateString() === n.toDateString()) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const y = new Date(now - 86400000)
  if (d.toDateString() === y.toDateString()) return 'gestern'
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear() === n.getFullYear() ? '' : d.getFullYear()}`
}

interface State {
  list: ChatMeta[]
  loaded: boolean
  refresh: () => Promise<boolean>
  save: (chat: SavedChat) => Promise<void>
  load: <M>(id: string) => Promise<SavedChat<M>>
  rename: (id: string, title: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useChats = create<State>()((set, get) => ({
  list: [],
  loaded: false,
  refresh: async () => {
    try {
      const r = await fetch(COMPANION + '/chats')
      const list = await r.json()
      if (!Array.isArray(list)) return false // an old companion answers with the app page instead
      set({ list, loaded: true })
      return true
    } catch { return false }
  },
  save: async (chat) => {
    const meta = await companionPost<ChatMeta>('/chats', chat)
    if (meta && meta.id) set({ list: [meta, ...get().list.filter((c) => c.id !== meta.id)], loaded: true })
  },
  load: async <M,>(id: string) => {
    const r = await fetch(`${COMPANION}/chats/${id}`)
    const chat = await r.json()
    if (!r.ok || !Array.isArray(chat.messages)) throw new Error(chat.error || 'Chat nicht gefunden.')
    return chat as SavedChat<M>
  },
  rename: async (id, title) => {
    const t = title.trim()
    if (!t) return
    set({ list: get().list.map((c) => (c.id === id ? { ...c, title: t } : c)) }) // optimistic
    const meta = await companionPost<ChatMeta>('/chats/rename', { id, title: t })
    if (meta && meta.id) set({ list: get().list.map((c) => (c.id === id ? meta : c)) })
  },
  remove: async (id) => {
    set({ list: get().list.filter((c) => c.id !== id) }) // optimistic
    await companionPost('/chats/delete', { id }).catch(() => {})
  },
}))
