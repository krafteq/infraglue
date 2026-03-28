import { execFile } from 'child_process'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { join } from 'path'

const CLI_SOURCE = join(__dirname, '..', 'index.ts')
const CLI_DIST = join(__dirname, '..', '..', 'dist', 'index.js')
const FIXTURE_DIR = join(__dirname, '..', 'core', '__fixtures__', 'simple-chain')

function startMockGitLabApi(): Promise<{ server: Server; port: number; requests: { method: string; url: string }[] }> {
  return new Promise((resolve) => {
    const requests: { method: string; url: string }[] = []

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      requests.push({ method: req.method ?? '', url: req.url ?? '' })

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
      resolve({ server, port, requests })
    })
  })
}

function runCli(
  entrypoint: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const usesTsx = entrypoint.endsWith('.ts')
  const cmd = usesTsx ? 'npx' : process.execPath
  const cmdArgs = usesTsx ? ['tsx', entrypoint, ...args] : [entrypoint, ...args]

  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      cmdArgs,
      {
        env: { ...process.env, ...env },
        timeout: 30_000,
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error?.code ?? child.exitCode ?? 0,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        })
      },
    )
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

  describe.each([
    { label: 'source (tsx)', entrypoint: CLI_SOURCE },
    { label: 'built (dist)', entrypoint: CLI_DIST },
  ])('$label', ({ entrypoint }) => {
    it('should exit with code 2 when plan has changes (FRESH state)', async () => {
      const result = await runCli(entrypoint, ['-d', FIXTURE_DIR, 'ci', '--env', 'dev'], makeGitLabEnv(mockApi.port))

      console.log(`[${entrypoint.includes('dist') ? 'dist' : 'src'}] EXIT CODE: ${result.exitCode}`)
      if (result.exitCode !== 2) {
        console.log('STDOUT:', result.stdout)
        console.log('STDERR:', result.stderr)
      }

      expect(result.exitCode).toBe(2)
    }, 30_000)

    it('should exit with code 2 (UserError) when not in MR pipeline', async () => {
      const result = await runCli(entrypoint, ['-d', FIXTURE_DIR, 'ci', '--env', 'dev'], {})

      expect(result.exitCode).toBe(2)
    }, 30_000)
  })
})
