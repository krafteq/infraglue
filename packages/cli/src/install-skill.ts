import { dirname, join } from 'path'
import { readFile, writeFile, mkdir, access } from 'fs/promises'
import { fileURLToPath } from 'url'
import { UserError } from './utils/index.js'

export function getSkillSourcePath(): string {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  return join(__dirname, '../skill/SKILL.md')
}

export async function installSkill(
  targetDir: string,
  options: { force?: boolean } = {},
): Promise<{ destPath: string; overwritten: boolean }> {
  const sourcePath = getSkillSourcePath()
  const destDir = join(targetDir, '.claude', 'skills', 'infraglue')
  const destPath = join(destDir, 'SKILL.md')

  let overwritten = false
  if (!options.force) {
    try {
      await access(destPath)
      throw new UserError(`Skill already exists at ${destPath}. Use --force to overwrite.`)
    } catch (err) {
      if (err instanceof UserError) throw err
      // file doesn't exist, proceed
    }
  } else {
    try {
      await access(destPath)
      overwritten = true
    } catch {
      // file doesn't exist, not an overwrite
    }
  }

  const content = await readFile(sourcePath, 'utf-8')
  await mkdir(destDir, { recursive: true })
  await writeFile(destPath, content, 'utf-8')

  return { destPath, overwritten }
}
