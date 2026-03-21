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

function getSetAllArgs(): string[][] {
  return vi
    .mocked(execFile)
    .mock.calls.filter((c) => {
      const args = c[1] as string[]
      return args[0] === 'config' && args[1] === 'set-all'
    })
    .map((c) => c[1] as string[])
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

  it('should use a single set-all call instead of one process per key', async () => {
    const input: ProviderInput = {
      key1: { value: 'val1', secret: false },
      key2: { value: 'val2', secret: false },
      key3: { value: 'val3', secret: true },
    }

    try {
      await pulumiProvider.getPlan(makeConfig(), input, 'dev')
    } catch {
      // ignore parse error
    }

    const setAllCalls = getSetAllArgs()
    expect(setAllCalls).toHaveLength(1)
    expect(setAllCalls[0]).toEqual([
      'config',
      'set-all',
      '--plaintext',
      'key1=val1',
      '--plaintext',
      'key2=val2',
      '--secret',
      'key3=val3',
    ])
  })

  it('should pass values with shell-special characters safely via execFile', async () => {
    const input: ProviderInput = {
      db_password: { value: 'p@ss^w&rd$100!', secret: true },
    }

    try {
      await pulumiProvider.getPlan(makeConfig(), input, 'dev')
    } catch {
      // ignore parse error
    }

    expect(execFile).toHaveBeenCalledWith(
      'pulumi',
      ['config', 'set-all', '--secret', 'db_password=p@ss^w&rd$100!'],
      expect.any(Object),
      expect.any(Function),
    )
  })

  it('should mark non-secret values with --plaintext', async () => {
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
      ['config', 'set-all', '--plaintext', 'app_name=my-app'],
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
      ['config', 'set-all', '--plaintext', 'connection_string=host=db user="admin" pass=`secret`'],
      expect.any(Object),
      expect.any(Function),
    )
  })

  it('should skip execFile call when there are no vars to set', async () => {
    try {
      await pulumiProvider.getPlan(makeConfig(), {}, 'dev')
    } catch {
      // ignore parse error
    }

    const setAllCalls = getSetAllArgs()
    expect(setAllCalls).toHaveLength(0)
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

    const setAllCalls = getSetAllArgs()
    expect(setAllCalls).toHaveLength(1)

    const args = setAllCalls[0]
    // 'shared' should be set to 'input-val' (input overrides rootVars and envVars)
    expect(args).toContain('--plaintext')
    expect(args).toContain('shared=input-val')
    // 'env_only' should still be present
    expect(args).toContain('env_only=e')
    // 'shared=root-val' and 'shared=env-val' should NOT appear
    expect(args).not.toContain('shared=root-val')
    expect(args).not.toContain('shared=env-val')
  })
})
