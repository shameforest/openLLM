import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Attachment, fileUrl, filePart, fmtKB, isImageName, mergeAttachments, mimeFor, withAttachmentLines } from './attachments'
import { sendPrompt } from './api'

describe('mimeFor', () => {
  it('maps images, pdf and everything else', () => {
    expect(mimeFor('a.png')).toBe('image/png')
    expect(mimeFor('a.jpg')).toBe('image/jpeg')
    expect(mimeFor('a.jpeg')).toBe('image/jpeg')
    expect(mimeFor('a.gif')).toBe('image/gif')
    expect(mimeFor('a.webp')).toBe('image/webp')
    expect(mimeFor('a.pdf')).toBe('application/pdf')
    expect(mimeFor('notes.txt')).toBe('text/plain')
    expect(mimeFor('main.tsx')).toBe('text/plain')
    expect(mimeFor('Makefile')).toBe('text/plain')
    expect(mimeFor('archiv.tar.gz')).toBe('text/plain')
  })
  it('ignores the case of the extension', () => {
    expect(mimeFor('FOTO.PNG')).toBe('image/png')
    expect(mimeFor('Scan.Pdf')).toBe('application/pdf')
  })
  it('knows what an image is (for the "only if the model understands images" hint)', () => {
    expect(isImageName('foto.JPG')).toBe(true)
    expect(isImageName('doku.pdf')).toBe(false)
    expect(isImageName('code.ts')).toBe(false)
  })
})

describe('fileUrl', () => {
  it('turns a Windows path into a file:/// url and keeps the drive colon', () => {
    expect(fileUrl('C:\\a\\b.txt')).toBe('file:///C:/a/b.txt')
  })
  it('encodes spaces, # and % in a Windows path with spaces', () => {
    expect(fileUrl('C:\\Users\\Shadow\\Meine Dokumente\\Bericht #1 (100%).txt'))
      .toBe('file:///C:/Users/Shadow/Meine%20Dokumente/Bericht%20%231%20(100%25).txt')
  })
  it('encodes ? and non-ASCII characters', () => {
    expect(fileUrl('C:\\x\\Frage?.txt')).toBe('file:///C:/x/Frage%3F.txt')
    expect(fileUrl('C:\\Übersicht\\größe.md')).toBe('file:///C:/%C3%9Cbersicht/gr%C3%B6%C3%9Fe.md')
  })
  it('accepts forward slashes, network paths and POSIX paths', () => {
    expect(fileUrl('C:/a/b c.txt')).toBe('file:///C:/a/b%20c.txt')
    expect(fileUrl('\\\\server\\share\\x y.txt')).toBe('file://server/share/x%20y.txt')
    expect(fileUrl('/home/x/a b.txt')).toBe('file:///home/x/a%20b.txt')
  })
  it('round-trips through the URL parser (the way OpenCode reads it)', () => {
    const u = new URL(fileUrl('C:\\Users\\Shadow\\Meine Dokumente\\Bericht #1 (100%).txt'))
    expect(u.protocol).toBe('file:')
    expect(decodeURIComponent(u.pathname)).toBe('/C:/Users/Shadow/Meine Dokumente/Bericht #1 (100%).txt')
    expect(u.hash).toBe('')
  })
})

describe('filePart', () => {
  it('has the shape of an OpenCode file part', () => {
    const a: Attachment = { path: 'C:\\Users\\Shadow\\Meine Dokumente\\notiz.txt', name: 'notiz.txt', size: 12 }
    expect(filePart(a)).toEqual({
      type: 'file', mime: 'text/plain', filename: 'notiz.txt', url: 'file:///C:/Users/Shadow/Meine%20Dokumente/notiz.txt',
    })
  })
  it('uses the image mime type for pictures', () => {
    expect(filePart({ path: 'D:\\Bilder\\foto.png', name: 'foto.png' })).toEqual({
      type: 'file', mime: 'image/png', filename: 'foto.png', url: 'file:///D:/Bilder/foto.png',
    })
  })
})

describe('fmtKB', () => {
  it('shows whole KB, at least 1 KB for a non-empty file', () => {
    expect(fmtKB(0)).toBe('0 KB')
    expect(fmtKB(5)).toBe('1 KB')
    expect(fmtKB(2048)).toBe('2 KB')
    expect(fmtKB(1536)).toBe('2 KB')
    expect(fmtKB(1024 * 1024)).toBe('1.024 KB')
  })
})

describe('mergeAttachments / withAttachmentLines', () => {
  const a: Attachment = { path: 'C:\\a.txt', name: 'a.txt' }
  const b: Attachment = { path: 'C:\\b.txt', name: 'b.txt' }
  it('adds new files and skips the ones already attached', () => {
    expect(mergeAttachments([a], [a, b, b])).toEqual([a, b])
    expect(mergeAttachments([], [])).toEqual([])
  })
  it('appends one 📎 line per file to the shown message', () => {
    expect(withAttachmentLines('Fasse zusammen', [])).toBe('Fasse zusammen')
    expect(withAttachmentLines('Fasse zusammen', [a, b])).toBe('Fasse zusammen\n📎 a.txt\n📎 b.txt')
  })
})

describe('sendPrompt parts', () => {
  afterEach(() => vi.unstubAllGlobals())
  /** Call sendPrompt with a fake fetch and return the JSON body that would have been sent. */
  const bodyOf = async (call: () => Promise<void>, fetchMock = vi.fn(async (..._args: unknown[]) => new Response(null, { status: 204 }))) => {
    vi.stubGlobal('fetch', fetchMock)
    await call()
    const init = fetchMock.mock.calls[0][1] as RequestInit
    return JSON.parse(String(init.body))
  }
  it('sends only the text part when nothing is attached (as before)', async () => {
    const body = await bodyOf(() => sendPrompt('ses_1', 'Hallo', 'qwen', 'C:\\proj'))
    expect(body.parts).toEqual([{ type: 'text', text: 'Hallo' }])
  })
  it('appends one file part per attachment after the text part', async () => {
    const files: Attachment[] = [{ path: 'C:\\x\\a b.txt', name: 'a b.txt' }, { path: 'C:\\x\\f.png', name: 'f.png' }]
    const body = await bodyOf(() => sendPrompt('ses_1', 'Hallo', 'qwen', 'C:\\proj', 'build', undefined, files))
    expect(body.parts).toEqual([
      { type: 'text', text: 'Hallo' },
      { type: 'file', mime: 'text/plain', filename: 'a b.txt', url: 'file:///C:/x/a%20b.txt' },
      { type: 'file', mime: 'image/png', filename: 'f.png', url: 'file:///C:/x/f.png' },
    ])
    expect(body.agent).toBe('build')
  })
})
