import { describe, expect, it } from 'vitest'
import type { PermissionRequest } from './api'
import { LOOP_HINT, autoDecision, describePermission } from './requests'

const req = (permission: string, metadata: Record<string, unknown> = {}, patterns: string[] = []): PermissionRequest =>
  ({ id: 'per_1', sessionID: 'ses_1', permission, metadata, patterns, always: [] })

describe('describePermission', () => {
  it('names the command, file, folder or loop in plain German', () => {
    expect(describePermission(req('bash', { command: 'mkdir src' }))).toEqual({ title: 'möchte einen Befehl ausführen', detail: 'mkdir src' })
    expect(describePermission(req('bash', {}, ['npm create vite*'])).detail).toBe('npm create vite*')
    expect(describePermission(req('external_directory', {}, ['C:/Users/x/*'])).title).toMatch(/außerhalb des Projekts/)
    expect(describePermission(req('doom_loop', { tool: 'bash' })).title).toMatch(/im Kreis/)
    expect(describePermission(req('lsp')).title).toBe('möchte „lsp“ verwenden')
  })
})

describe('autoDecision', () => {
  it('allows ordinary work once', () => {
    expect(autoDecision(req('bash', { command: 'mkdir src && npm install' }))).toEqual({ reply: 'once' })
    expect(autoDecision(req('external_directory', {}, ['C:/data/*']))).toEqual({ reply: 'once' })
  })
  it('turns a loop around with a hint instead of letting it repeat', () => {
    expect(autoDecision(req('doom_loop'))).toEqual({ reply: 'reject', message: LOOP_HINT })
  })
  it('leaves uploads, discarding work and deleting to the user', () => {
    for (const c of ['git push origin main', 'git -C C:/x push', 'git reset --hard HEAD~1', 'git clean -fd', 'Remove-Item -Recurse x', 'del /q x', 'rm -rf build'])
      expect(autoDecision(req('bash', { command: c }))).toBeNull()
  })
})
