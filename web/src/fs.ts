import { COMPANION } from './companion'

// Browse the PC's folders through the companion (the browser itself cannot read the file system). Used by FolderPicker
// (folders only) and FilePicker (folders + files, for "Datei anhängen").
export interface FsEntry { name: string; path: string }
export interface FsFile extends FsEntry { size: number }
export interface FsListing { path: string; parent: string | null; dirs: FsEntry[]; files?: FsFile[] }

/** List the sub-folders of `path` (directories only). No path → the drive roots and a few handy starting points.
 *  With `withFiles` the answer also carries `files` (regular files with their size, at most 500, sorted by name). */
export async function listDir(path?: string, withFiles = false): Promise<FsListing> {
  const query = [path ? `path=${encodeURIComponent(path)}` : '', withFiles ? 'files=1' : ''].filter(Boolean).join('&')
  const r = await fetch(`${COMPANION}/fs${query ? `?${query}` : ''}`)
  const j = await r.json()
  if (!r.ok || !Array.isArray(j.dirs)) throw new Error(j.error || 'Der lokale Dienst läuft nicht — Ordner erst nach dem Start von OpenDante.')
  return j as FsListing
}

/** Last path segment, for showing a short folder name (handles both \ and /). */
export const baseName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
