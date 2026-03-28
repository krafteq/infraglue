import { spawn } from 'child_process'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { join } from 'path'

const CLI_SOURCE = join(__dirname, '..', 'index.ts')
const CLI_DIST = join(__dirname, '..', '..', 'dist', 'index.js')
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'ig.js')
const FIXTURE_DIR = join(__dirname, '..', 'core', '__fixtures__', 'simple-chain')

function startMockGitLabApi(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        if (req.method === 'GET' && req.url?.includes('/notes')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('[]')
          return
        }
        if (req.method === 'POST' && req.url?.includes('/notes')) {
          res.writeHead(201, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ id: 1, body }))
          return
        }
        res.writeHead(404)
        res.end('Not found')
      })
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ server, port })
    })
  })
}

function runIg(
  cmd: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ exitCode: number | null; stderr: string; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.stdout.on('data', () => {})

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
    }, 25_000)

    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ exitCode: code, stderr, signal })
    })
  })
}

function makeGitLabEnv(port: number): Record<string, string> {
  return {
    GITLAB_CI: 'true',
    CI_MERGE_REQUEST_IID: '1',
    CI_MERGE_REQUEST_PROJECT_ID: '99',
    CI_API_V4_URL: `http://127.0.0.1:${port}/api/v4`,
    CI_COMMIT_SHA: 'abc123',
    CI_PIPELINE_ID: 'pipe-1',
    GITLAB_ACCESS_TOKEN: 'test-token',
  }
}

describe('ig ci exit code (e2e)', () => {
  let mockApi: Awaited<ReturnType<typeof startMockGitLabApi>>

  beforeEach(async () => {
    mockApi = await startMockGitLabApi()
  })

  afterEach(() => {
    mockApi.server.close()
  })

  const entrypoints = [
    { label: 'source (tsx)', cmd: 'npx', makeArgs: (a: string[]) => ['tsx', CLI_SOURCE, ...a] },
    { label: 'dist (node)', cmd: process.execPath, makeArgs: (a: string[]) => [CLI_DIST, ...a] },
    { label: 'bin/ig.js (node)', cmd: process.execPath, makeArgs: (a: string[]) => [CLI_BIN, ...a] },
  ]

  describe.each(entrypoints)('$label', ({ label, cmd, makeArgs }) => {
    it('should exit 2 when plan has changes (FRESH state)', async () => {
      const igArgs = ['-d', FIXTURE_DIR, 'ci', '--env', 'dev']
      const result = await runIg(cmd, makeArgs(igArgs), makeGitLabEnv(mockApi.port))

      console.log(`[${label}] status=${result.exitCode} signal=${result.signal}`)
      if (result.exitCode !== 2) {
        console.log('STDERR:', result.stderr.slice(-500))
      }

      expect(result.signal).toBeNull()
      expect(result.exitCode).toBe(2)
    }, 30_000)

    it('should exit 2 (UserError) when not in MR pipeline', async () => {
      const igArgs = ['-d', FIXTURE_DIR, 'ci', '--env', 'dev']
      const result = await runIg(cmd, makeArgs(igArgs), {})

      console.log(`[${label}] not-in-pipeline status=${result.exitCode}`)

      expect(result.signal).toBeNull()
      expect(result.exitCode).toBe(2)
    }, 30_000)
  })
})
