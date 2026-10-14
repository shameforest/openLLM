import { describe, expect, it } from 'vitest'
import { skillNameFrom } from './SettingsPanel'

describe('skillNameFrom', () => {
  it('reads name: from the front-matter head', () => {
    const md = '---\nname: gruendlich-debuggen\ndescription: x\n---\n# body'
    expect(skillNameFrom(md, 'SKILL.md')).toBe('gruendlich-debuggen')
  })

  it('strips surrounding quotes', () => {
    expect(skillNameFrom('---\nname: "test-runner"\n---\n', 'whatever.md')).toBe('test-runner')
  })

  it('falls back to the file name without extension when there is no head', () => {
    expect(skillNameFrom('# just a heading\nno front matter', 'My Skill.md')).toBe('My Skill')
  })

  it('falls back to the file name when the head has no name field', () => {
    expect(skillNameFrom('---\ndescription: only this\n---\n', 'code-lesen-zuerst.markdown')).toBe('code-lesen-zuerst')
  })
})
