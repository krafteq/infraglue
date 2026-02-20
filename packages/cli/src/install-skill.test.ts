import { vi } from 'vitest'
import { UserError } from './utils/index.js'

const mockAccess = vi.fn()
const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()
const mockMkdir = vi.fn()

vi.mock('fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}))

const { installSkill, getSkillSourcePath } = await import('./install-skill.js')

describe('installSkill', () => {
  const skillContent = '---\nname: infraglue\n---\n# InfraGlue'

  beforeEach(() => {
    vi.clearAllMocks()
    mockReadFile.mockResolvedValue(skillContent)
    mockWriteFile.mockResolvedValue(undefined)
    mockMkdir.mockResolvedValue(undefined)
    // Default: file does not exist
    mockAccess.mockRejectedValue(new Error('ENOENT'))
  })

  it('should create directory and write SKILL.md', async () => {
    const result = await installSkill('/my/project')

    expect(mockMkdir).toHaveBeenCalledWith('/my/project/.claude/skills/infraglue', { recursive: true })
    expect(mockWriteFile).toHaveBeenCalledWith('/my/project/.claude/skills/infraglue/SKILL.md', skillContent, 'utf-8')
    expect(result.destPath).toBe('/my/project/.claude/skills/infraglue/SKILL.md')
    expect(result.overwritten).toBe(false)
  })

  it('should throw UserError when file exists without --force', async () => {
    mockAccess.mockResolvedValue(undefined) // file exists

    await expect(installSkill('/my/project')).rejects.toThrow(UserError)
    await expect(installSkill('/my/project')).rejects.toThrow('Use --force to overwrite')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('should overwrite when --force is true and file exists', async () => {
    mockAccess.mockResolvedValue(undefined) // file exists

    const result = await installSkill('/my/project', { force: true })

    expect(mockWriteFile).toHaveBeenCalled()
    expect(result.overwritten).toBe(true)
  })

  it('should set overwritten to false when --force is true but file does not exist', async () => {
    const result = await installSkill('/my/project', { force: true })

    expect(mockWriteFile).toHaveBeenCalled()
    expect(result.overwritten).toBe(false)
  })
})

describe('getSkillSourcePath', () => {
  it('should resolve to a path ending in skill/SKILL.md', () => {
    const path = getSkillSourcePath()
    expect(path).toMatch(/skill\/SKILL\.md$/)
  })
})
