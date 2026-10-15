// Files attached to a chat message ("Datei anhängen"). OpenCode's prompt endpoint takes file parts
// { type: 'file', mime, filename, url }; with a file:// url it reads the file from disk itself and hands the content to
// the model. The browser cannot read the disk, so the app only knows the path (picked in FilePicker via the companion).

export interface Attachment { path: string; name: string; size?: number }

/** One file part of a prompt, as OpenCode's /session/:id/prompt_async expects it. */
export interface FilePart { type: 'file'; mime: string; filename: string; url: string }

/** Above this size a file is flagged as costly: its content fills the model's context window. */
export const LARGE_FILE_BYTES = 1024 * 1024
export const IMAGE_HINT = 'nur wenn das Modell Bilder versteht'

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
}

/** MIME type from the file name: png/jpg/jpeg/gif/webp → image/*, pdf → application/pdf, everything else → text/plain. */
export function mimeFor(name: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  return MIME_BY_EXT[ext] ?? 'text/plain'
}

export const isImageName = (name: string): boolean => mimeFor(name).startsWith('image/')

/** `C:\a\b c.txt` → `file:///C:/a/b%20c.txt`. Spaces, `#`, `%`, `?` and non-ASCII characters are percent-encoded (encodeURI
 *  rules, plus `#` and `?` which would otherwise start a fragment or query); the drive colon stays. A network path
 *  `\\server\share\x.txt` becomes `file://server/share/x.txt`, a POSIX path `/home/x` becomes `file:///home/x`. */
export function fileUrl(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  let encoded: string
  try { encoded = encodeURI(slashed) } catch { encoded = slashed.replace(/%/g, '%25').replace(/ /g, '%20') } // lone surrogate in a name
  encoded = encoded.replace(/#/g, '%23').replace(/\?/g, '%3F')
  if (encoded.startsWith('//')) return `file:${encoded}`      // \\server\share\…
  if (encoded.startsWith('/')) return `file://${encoded}`     // /home/…
  return `file:///${encoded}`                                  // C:/…
}

/** The prompt part that makes OpenCode read this file. */
export const filePart = (a: Attachment): FilePart => ({ type: 'file', mime: mimeFor(a.name), filename: a.name, url: fileUrl(a.path) })

/** File size for the picker: whole KB, at least 1 KB for a non-empty file (e.g. "1.465 KB"). */
export function fmtKB(bytes: number): string {
  if (!bytes || bytes < 0) return '0 KB'
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('de-DE')} KB`
}

/** Add `more` to `list`, skipping files that are already in it (same path). */
export function mergeAttachments(list: Attachment[], more: Attachment[]): Attachment[] {
  const seen = new Set(list.map((a) => a.path))
  const out = [...list]
  for (const a of more) if (!seen.has(a.path)) { seen.add(a.path); out.push(a) }
  return out
}

/** The user's message as the chat window shows it: the text, then one `📎 name` line per attached file. */
export const withAttachmentLines = (text: string, files: Attachment[]): string =>
  files.length ? `${text}\n${files.map((f) => `📎 ${f.name}`).join('\n')}` : text
