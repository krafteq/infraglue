import { describe, it, expect, vi } from 'vitest'
import { spawnWithLineStream } from './spawn-command.js'

describe('spawnWithLineStream', () => {
  it('captures stdout lines via callback', async () => {
    const lines: string[] = []
    const result = await spawnWithLineStream('printf "line1\\nline2\\nline3"', {
      cwd: '/tmp',
      onStdoutLine: (line) => lines.push(line),
    })

    expect(result.exitCode).toBe(0)
    expect(lines).toEqual(['line1', 'line2', 'line3'])
    expect(result.stdout).toBe('line1\nline2\nline3')
  })

  it('captures stderr lines when callback provided', async () => {
    const stderrLines: string[] = []
    const result = await spawnWithLineStream('echo "err msg" >&2', {
      cwd: '/tmp',
      onStdoutLine: () => {},
      onStderrLine: (line) => stderrLines.push(line),
    })

    expect(result.exitCode).toBe(0)
    expect(stderrLines).toEqual(['err msg'])
  })

  it('returns non-zero exit code on failure', async () => {
    const result = await spawnWithLineStream('exit 1', {
      cwd: '/tmp',
      onStdoutLine: () => {},
    })

    expect(result.exitCode).toBe(1)
  })

  it('accumulates all stdout in result', async () => {
    const result = await spawnWithLineStream('printf "a\\nb\\nc"', {
      cwd: '/tmp',
      onStdoutLine: () => {},
    })

    expect(result.stdout).toBe('a\nb\nc')
  })

  it('calls onStdoutLine for each line in order', async () => {
    const callOrder: number[] = []
    let counter = 0
    await spawnWithLineStream('printf "x\\ny\\nz"', {
      cwd: '/tmp',
      onStdoutLine: () => {
        callOrder.push(counter++)
      },
    })

    expect(callOrder).toEqual([0, 1, 2])
  })
})
