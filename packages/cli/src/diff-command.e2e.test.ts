import { execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { generateBashCompletion, generateFishCompletion, generateZshCompletion } from './completions.js'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const nodeMajor = Number(process.versions.node.split('.')[0])

describe('diff command CLI wiring', () => {
  it.skipIf(nodeMajor < 22)('shows supported selection flags in help', async () => {
    const { stdout } = await execFileAsync('pnpm', ['exec', 'tsx', './packages/cli/src/index.ts', 'diff', '--help'], {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: '1' },
    })

    expect(stdout).toContain('Usage: ig diff')
    expect(stdout).toContain('--env <env>')
    expect(stdout).toContain('--project <project>')
    expect(stdout).toContain('--no-deps')
    expect(stdout).toContain('--start-with-project <project>')
  })

  it('includes diff command and flags in generated shell completions', () => {
    const bash = generateBashCompletion()
    const zsh = generateZshCompletion()
    const fish = generateFishCompletion()

    expect(bash).toContain('plan diff ci')
    expect(bash).toContain('--start-with-project')

    expect(zsh).toContain("'diff:Show detailed infrastructure property changes without applying'")
    expect(zsh).toContain('diff)')
    expect(zsh).toContain('--start-with-project[Skip levels before project]:project:')

    expect(fish).toContain("-a diff -d 'Show detailed infrastructure property changes without applying'")
    expect(fish).toContain('__fish_seen_subcommand_from diff')
    expect(fish).toContain('-l start-with-project')
  })
})
