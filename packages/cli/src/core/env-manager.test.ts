import { vi } from 'vitest'
import { EnvManager } from './env-manager.js'
import { Monorepo, Workspace } from './model.js'
import { MockProvider } from '../__test-utils__/mock-provider.js'
import { State } from './state-manager.js'

const mockRead = vi.fn<() => Promise<State>>()
const mockUpdate = vi.fn<(fn: (s: State) => void) => Promise<void>>()

vi.mock('./state-manager.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./state-manager.js')>()
  return {
    ...original,
    StateManager: vi.fn().mockImplementation(() => ({
      read: mockRead,
      update: mockUpdate,
    })),
  }
})

vi.mock('./workspace-interop.js', () => {
  return {
    WorkspaceInterop: vi.fn().mockImplementation(() => ({
      selectEnvironment: vi.fn().mockResolvedValue(undefined),
    })),
  }
})

function createTestMonorepo(envs: Record<string, string[]>) {
  const workspaces = Object.entries(envs).map(([name, envList]) => {
    const envConfig = envList.reduce((acc, env) => ({ ...acc, [env]: {} }), {} as Record<string, object>)
    return new Workspace(name, `/path/to/${name}`, '/root', new MockProvider(), {}, [], envConfig)
  })
  return new Monorepo('/root', workspaces, [], undefined)
}

describe('EnvManager', () => {
  let sharedState: State

  beforeEach(() => {
    vi.clearAllMocks()
    sharedState = new State()
    mockRead.mockResolvedValue(sharedState)
    // Use a shared state so startSelectingEnv and finishEnvSelection work together
    mockUpdate.mockImplementation(async (fn) => {
      fn(sharedState)
    })
  })

  it('should call selectEnvironment for workspaces that have the env', async () => {
    const monorepo = createTestMonorepo({
      ws1: ['dev', 'prod'],
      ws2: ['dev'],
      ws3: ['prod'],
    })
    const { WorkspaceInterop } = await import('./workspace-interop.js')

    const manager = new EnvManager(monorepo)
    await manager.selectEnv('dev')

    // Only ws1 and ws2 have 'dev' env, so only 2 WorkspaceInterop instances
    expect(WorkspaceInterop).toHaveBeenCalledTimes(2)
  })

  it('should call stateManager.update for start and finish', async () => {
    const monorepo = createTestMonorepo({ ws1: ['dev'] })

    const manager = new EnvManager(monorepo)
    await manager.selectEnv('dev')

    // startSelectingEnv + finishEnvSelection = 2 update calls
    expect(mockUpdate).toHaveBeenCalledTimes(2)
  })

  describe('selectedEnv', () => {
    it('should return current env when selected', async () => {
      sharedState.startSelectingEnv('dev')
      sharedState.finishEnvSelection(['ws1'])

      const monorepo = createTestMonorepo({ ws1: ['dev'] })
      const manager = new EnvManager(monorepo)
      const env = await manager.selectedEnv()
      expect(env).toBe('dev')
    })

    it('should throw UserError when no env selected', async () => {
      const monorepo = createTestMonorepo({ ws1: ['dev'] })
      const manager = new EnvManager(monorepo)
      await expect(manager.selectedEnv()).rejects.toThrow('No environment selected')
    })
  })
})
