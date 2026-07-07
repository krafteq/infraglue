import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProviderConfig, ProviderInput } from './provider.js'
import type { SpawnStreamOptions, SpawnStreamResult } from './spawn-command.js'

const spawnWithLineStream = vi.hoisted(() =>
  vi.fn<(command: string, options: SpawnStreamOptions) => Promise<SpawnStreamResult>>(),
)

vi.mock('child_process', () => ({
  exec: vi.fn(
    (_cmd: string, optsOrCb: unknown, cb?: (err: null, result: { stdout: string; stderr: string }) => void) => {
      const callback = typeof optsOrCb === 'function' ? optsOrCb : cb
      callback?.(null, { stdout: '{}', stderr: '' })
    },
  ),
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

vi.mock('./spawn-command.js', () => ({
  spawnWithLineStream,
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

function getPulumiCommands(): string[] {
  return spawnWithLineStream.mock.calls.map(([command]) => command)
}

describe('PulumiProvider.setPulumiConfig (via getPlan)', () => {
  beforeEach(() => {
    spawnWithLineStream.mockReset()
    spawnWithLineStream.mockResolvedValue({ exitCode: 0, stdout: '{}' })

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
      optsOrCb: unknown,
      cb?: (err: null, result: { stdout: string; stderr: string }) => void,
    ) => {
      const callback = typeof optsOrCb === 'function' ? optsOrCb : cb
      callback?.(null, { stdout: '{}', stderr: '' })
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

describe('PulumiProvider.selectEnvironment', () => {
  beforeEach(() => {
    spawnWithLineStream.mockReset()
    spawnWithLineStream.mockResolvedValue({ exitCode: 0, stdout: '' })

    vi.mocked(exec).mockReset()
    vi.mocked(exec).mockImplementation(((
      _cmd: string,
      optsOrCb: unknown,
      cb?: (err: null, result: { stdout: string; stderr: string }) => void,
    ) => {
      const callback = typeof optsOrCb === 'function' ? optsOrCb : cb
      callback?.(null, { stdout: '{}', stderr: '' })
    }) as never)
  })

  it('should initialize a stack only when Pulumi explicitly reports it is missing', async () => {
    let selectAttempts = 0
    spawnWithLineStream.mockImplementation(async (command, options) => {
      if (command === 'pulumi stack select qa') {
        selectAttempts += 1
        if (selectAttempts === 1) {
          options.onStderrLine?.("error: no stack named 'qa' found")
          return { exitCode: 1, stdout: '' }
        }
      }

      return { exitCode: 0, stdout: '' }
    })

    await pulumiProvider.selectEnvironment(makeConfig({ envs: { qa: { backend_config: {} } } }), 'qa')

    expect(getPulumiCommands()).toEqual([
      'pulumi install',
      'pulumi stack select qa',
      'pulumi stack init qa',
      'pulumi stack select qa',
    ])
  })

  it('should fail fast and not initialize when stack selection reports a backend error', async () => {
    spawnWithLineStream.mockImplementation(async (command, options) => {
      if (command === 'pulumi stack select qa') {
        options.onStderrLine?.(
          'error: failed to list stacks: azureblob.OpenBucket: dial tcp: lookup storage.example.net: no such host',
        )
        return { exitCode: 1, stdout: '' }
      }

      return { exitCode: 0, stdout: '' }
    })

    await expect(
      pulumiProvider.selectEnvironment(makeConfig({ envs: { qa: { backend_config: {} } } }), 'qa'),
    ).rejects.toThrow(/failed to list stacks|azureblob|dial tcp/)

    expect(getPulumiCommands()).toEqual(['pulumi install', 'pulumi stack select qa'])
  })
})
