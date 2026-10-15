import { describe, expect, it } from 'vitest'
import { baseName } from './fs'
import { useSettings } from './settings'

describe('baseName', () => {
  it('takes the last segment of Windows and POSIX paths, trailing slashes ignored', () => {
    expect(baseName('C:\\Users\\Shadow\\code')).toBe('code')
    expect(baseName('C:\\Users\\Shadow\\code\\')).toBe('code')
    expect(baseName('/home/x/projekt/')).toBe('projekt')
    expect(baseName('C:\\')).toBe('C:')
  })
})

describe('saved folders', () => {
  it('adds folders without duplicates and switches to the first; removing the active one falls back to default', () => {
    const s = useSettings.getState()
    s.set({ folders: [], workdir: '' })
    s.addFolders(['C:\\a', 'C:\\b', 'C:\\a']) // duplicate ignored
    expect(useSettings.getState().folders).toEqual(['C:\\a', 'C:\\b'])
    expect(useSettings.getState().workdir).toBe('C:\\a')
    s.addFolders(['C:\\b', 'C:\\c'])
    expect(useSettings.getState().folders).toEqual(['C:\\a', 'C:\\b', 'C:\\c'])
    expect(useSettings.getState().workdir).toBe('C:\\b')
    s.removeFolder('C:\\b') // the active one
    expect(useSettings.getState().folders).toEqual(['C:\\a', 'C:\\c'])
    expect(useSettings.getState().workdir).toBe('') // back to the server's default folder
    s.set({ folders: [], workdir: '' }) // leave the store clean for other tests
  })
})
