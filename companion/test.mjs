// Self-contained check of the companion's file-writing endpoints. Run: node companion/test.mjs
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const cfg = await fs.mkdtemp(path.join(os.tmpdir(), 'opendante-'))
const PORT = 4096 + Math.floor(Math.random() * 500) + 50
const srv = spawn(process.execPath, [path.join(HERE, 'server.mjs')], {
  env: { ...process.env, OPENCODE_CONFIG_DIR: cfg, OPENDANTE_COMPANION_PORT: String(PORT) },
  stdio: 'ignore',
})
const base = `http://127.0.0.1:${PORT}`
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json())

let failed = 0
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL:', msg) } else console.log('ok:', msg) }

try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/health')).ok) break } catch {} await new Promise((r) => setTimeout(r, 100)) }

  await post('/settings', { globalInstructions: 'Antworte knapp.', apiKey: 'sk-ant-x', claudeModel: 'claude-opus-5-5' })
  const agents = await fs.readFile(path.join(cfg, 'AGENTS.md'), 'utf8')
  ok(agents.includes('Antworte knapp.') && agents.includes('OPENDANTE-USER-START'), 'global instructions written to AGENTS.md')
  const oc = JSON.parse(await fs.readFile(path.join(cfg, 'opencode.json'), 'utf8'))
  ok(oc.provider.anthropic.options.apiKey === 'sk-ant-x' && oc.provider.anthropic.models['claude-opus-5-5'], 'anthropic provider + key written')

  const s = await post('/skills', { name: 'Test Runner!', content: '---\nname: test-runner\n---\nbody' })
  ok(s.slug === 'test-runner', 'skill name slugified')
  ok((await fs.readFile(path.join(cfg, 'skills', 'test-runner', 'SKILL.md'), 'utf8')).includes('body'), 'skill saved as SKILL.md')

  await post('/settings', { globalInstructions: 'Neu.', apiKey: '', claudeModel: 'claude-opus-5-5' })
  const agents2 = await fs.readFile(path.join(cfg, 'AGENTS.md'), 'utf8')
  ok((agents2.match(/OPENDANTE-USER-START/g) || []).length === 1 && agents2.includes('Neu.'), 'user block replaced, not duplicated')
  const oc2 = JSON.parse(await fs.readFile(path.join(cfg, 'opencode.json'), 'utf8'))
  ok(!oc2.provider.anthropic, 'empty key removes the anthropic provider')
} finally {
  srv.kill()
  await fs.rm(cfg, { recursive: true, force: true })
}
console.log(failed ? `\n${failed} FAILED` : '\nall companion checks passed')
process.exit(failed ? 1 : 0)
