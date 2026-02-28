import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

export interface SpawnStreamOptions {
  cwd: string
  env?: NodeJS.ProcessEnv | undefined
  onStdoutLine: (line: string) => void
  onStderrLine?: (line: string) => void
}

export interface SpawnStreamResult {
  exitCode: number | null
  stdout: string
}

export function spawnWithLineStream(command: string, options: SpawnStreamOptions): Promise<SpawnStreamResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], {
      shell: true,
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const stdoutChunks: string[] = []

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => {
        stdoutChunks.push(line)
        options.onStdoutLine(line)
      })
    }

    if (child.stderr && options.onStderrLine) {
      const rl = createInterface({ input: child.stderr })
      rl.on('line', (line) => {
        options.onStderrLine!(line)
      })
    }

    child.on('error', (err) => {
      reject(err)
    })

    child.on('close', (exitCode) => {
      resolve({
        exitCode,
        stdout: stdoutChunks.join('\n'),
      })
    })
  })
}
