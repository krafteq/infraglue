import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProviderConfig, ProviderInput } from './provider.js'

vi.mock('child_process', () => ({
  exec: vi.fn((_cmd: string, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout: '{}', stderr: '' })
  }),
  execFile: vi.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: null, result: { stdout: string; stderr: string }) => void,
    ) => {
      cb(null, { stdout: '', stderr: '' })
    },
  ),
  spawn: vi.fn(),
}))

const { exec, execFile } = await import('child_process')
const { pulumiProvider } = await import('./pulumi-provider.js')

function makeConfig(overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    rootMonoRepoFolder: '/tmp/mono',
    rootPath: '/tmp/mono/ws',
    provider: 'pulumi',
    injections: {},
    envs: { dev: { backend_config: {} } },
    alias: 'ws',
    ...overrides,
  }
}

describe('PulumiProvider.setPulumiConfig (via getPlan)', () => {
  beforeEach(() => {
    vi.mocked(execFile).mockReset()
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: unknown,
        _opts: unknown,
        cb: (err: null, result: { stdout: string; stderr: string }) => void,
      ) => {
        cb(null, { stdout: '', stderr: '' })
        return undefined as never
      },
    )

    vi.mocked(exec).mockReset()
    vi.mocked(exec).mockImplementation(((
      _cmd: string,
      _opts: unknown,
      cb: (err: null, result: { stdout: string; stderr: string }) => void,
    ) => {
      cb(null, { stdout: '{}', stderr: '' })
    }) as never)
  })

  it('should pass values with shell-special characters safely via execFile', async () => {
    const input: ProviderInput = {
      db_password: { value: 'p@ss^w&rd$100!', secret: true },
    }

    try {
      await pulumiProvider.getPlan(makeConfig(), input, 'dev')
    } catch {
      // getPlan will fail on parsing empty JSON, that's fine — we only care about the execFile call
    }

    expect(execFile).toHaveBeenCalledWith(
      'pulumi',
      ['config', 'set', '--secret', 'db_password', '--', 'p@ss^w&rd$100!'],
      expect.any(Object),
      expect.any(Function),
    )
  })

  it('should pass non-secret values without --secret flag', async () => {
    const input: ProviderInput = {
      app_name: { value: 'my-app', secret: false },
    }

    try {
      await pulumiProvider.getPlan(makeConfig(), input, 'dev')
    } catch {
      // ignore parse error
    }

    expect(execFile).toHaveBeenCalledWith(
      'pulumi',
      ['config', 'set', 'app_name', '--', 'my-app'],
      expect.any(Object),
      expect.any(Function),
    )
  })

  it('should preserve values with spaces, quotes, and backticks', async () => {
    const input: ProviderInput = {
      connection_string: { value: 'host=db user="admin" pass=`secret`', secret: false },
    }

    try {
      await pulumiProvider.getPlan(makeConfig(), input, 'dev')
    } catch {
      // ignore parse error
    }

    expect(execFile).toHaveBeenCalledWith(
      'pulumi',
      ['config', 'set', 'connection_string', '--', 'host=db user="admin" pass=`secret`'],
      expect.any(Object),
      expect.any(Function),
    )
  })

  it('should merge rootVars, envVars, and input (input wins)', async () => {
    const config = makeConfig({
      rootVars: { shared: 'root-val' },
      envs: { dev: { vars: { shared: 'env-val', env_only: 'e' }, backend_config: {} } },
    })
    const input: ProviderInput = {
      shared: { value: 'input-val', secret: false },
    }

    try {
      await pulumiProvider.getPlan(config, input, 'dev')
    } catch {
      // ignore parse error
    }

    const calls = vi.mocked(execFile).mock.calls
    const setArgs = calls.map((c) => c[1] as string[])

    // 'shared' should be set to 'input-val' (input overrides rootVars and envVars)
    const sharedCall = setArgs.find((args) => args.includes('shared'))
    expect(sharedCall).toEqual(['config', 'set', 'shared', '--', 'input-val'])

    // 'env_only' should still be set
    const envOnlyCall = setArgs.find((args) => args.includes('env_only'))
    expect(envOnlyCall).toEqual(['config', 'set', 'env_only', '--', 'e'])
  })
})
