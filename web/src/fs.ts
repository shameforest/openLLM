import { COMPANION } from './companion'

// Browse the PC's folders through the companion (the browser itself cannot read the file system). Used by FolderPicker.
export interface FsEntry { name: string; path: string }
export interface FsListing { path: string; parent: string | null; dirs: FsEntry[] }

/** List the sub-folders of `path` (directories only). No path → the drive roots and a few handy starting points. */
export async function listDir(path?: string): Promise<FsListing> {
  const r = await fetch(`${COMPANION}/fs${path ? `?path=${encodeURIComponent(path)}` : ''}`)
  const j = await r.json()
  if (!r.ok || !Array.isArray(j.dirs)) throw new Error(j.error || 'Der lokale Dienst läuft nicht — Ordner erst nach dem Start von OpenDante.')
  return j as FsListing
}

/** Last path segment, for showing a short folder name (handles both \ and /). */
export const baseName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
