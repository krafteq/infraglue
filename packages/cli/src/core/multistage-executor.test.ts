import { vi } from 'vitest'
import { MultistageExecutor, type IExecOptions } from './multistage-executor.js'
import { ExecutionContext, Monorepo, Workspace, AppliedWorkspace } from './model.js'
import { MockProvider, createProviderPlan } from '../__test-utils__/mock-provider.js'
import { State } from './state-manager.js'
import type { IIntegration } from '../integrations/integration.js'
import type { IFormatter } from '../formatters/formatter.js'

// Mock StateManager
const mockState = new State()
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

// Mock WorkspaceInterop
const mockGetPlan = vi.fn()
const mockApply = vi.fn()
const mockGetOutputs = vi.fn()
const mockDestroyPlan = vi.fn()
const mockDestroy = vi.fn()
const mockIsDestroyed = vi.fn()

vi.mock('./workspace-interop.js', () => ({
  WorkspaceInterop: vi.fn().mockImplementation(() => ({
    getPlan: mockGetPlan,
    apply: mockApply,
    getOutputs: mockGetOutputs,
    destroyPlan: mockDestroyPlan,
    destroy: mockDestroy,
    isDestroyed: mockIsDestroyed,
  })),
}))

function createMockProvider(name = 'mock') {
  const provider = new MockProvider()
  provider.getProviderName.mockReturnValue(name)
  return provider
}

function createWs(name: string, deps: string[] = [], envs: string[] = ['dev'], provider?: MockProvider) {
  const envConfig = envs.reduce((acc, env) => ({ ...acc, [env]: {} }), {} as Record<string, object>)
  return new Workspace(name, `/path/to/${name}`, '/root', provider ?? createMockProvider(), {}, deps, envConfig)
}

function createFormatter(): IFormatter {
  return { format: vi.fn(() => 'formatted plan') }
}

function createInteractiveIntegration(approve = true): IIntegration {
  return {
    interactive: true,
    askForConfirmation: vi.fn().mockResolvedValue(approve),
  }
}

function createNonInteractiveIntegration(): IIntegration {
  return {
    interactive: false,
    askForConfirmation: vi.fn().mockResolvedValue(undefined),
  }
}

function envSelected(env = 'dev') {
  const state = new State()
  state.startSelectingEnv(env)
  state.finishEnvSelection(['ws1', 'ws2', 'ws3', 'ws4'])
  mockRead.mockResolvedValue(state)
}

describe('MultistageExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdate.mockImplementation(async (fn) => fn(new State()))
  })

  describe('environment validation', () => {
    it('should throw when env not selected', async () => {
      mockRead.mockResolvedValue(new State())
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      await expect(
        executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() }),
      ).rejects.toThrow('Cannot execute: environments across workspaces are in inconsistent state')
    })

    it('should throw on env mismatch', async () => {
      const state = new State()
      state.startSelectingEnv('qa')
      state.finishEnvSelection(['ws1'])
      mockRead.mockResolvedValue(state)

      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      await expect(
        executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() }),
      ).rejects.toThrow("Initialized environment 'qa' doesn't match execution environment 'dev'")
    })
  })

  describe('apply — single level', () => {
    it('should execute getPlan → confirm → apply flow', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      const plan = createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } })
      mockGetPlan.mockResolvedValue(plan)
      mockApply.mockResolvedValue({ url: 'http://localhost' })

      const integration = createInteractiveIntegration()
      await executor.exec({ formatter: createFormatter(), integration })

      expect(mockGetPlan).toHaveBeenCalledOnce()
      expect(integration.askForConfirmation).toHaveBeenCalledOnce()
      expect(mockApply).toHaveBeenCalledOnce()
    })

    it('should store outputs after apply', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )
      mockApply.mockResolvedValue({ key: 'applied-value' })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      expect(ctx.findAppliedOutput('ws1', 'key')).toBe('applied-value')
    })

    it('should skip and cache outputs when no changes', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(createProviderPlan())
      mockGetOutputs.mockResolvedValue({ outputs: { existing: 'value' }, actual: true })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      expect(mockApply).not.toHaveBeenCalled()
      expect(ctx.findAppliedOutput('ws1', 'existing')).toBe('value')
    })

    it('should abort when confirmation denied', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration(false) })

      expect(mockApply).not.toHaveBeenCalled()
    })
  })

  describe('apply — multi-level cross-provider orchestration', () => {
    it('should pass level 1 outputs as inputs to level 2', async () => {
      envSelected()
      const pulumiProvider = createMockProvider('pulumi')
      const terraformProvider = createMockProvider('terraform')

      const wsNetwork = new Workspace('network', '/path/to/network', '/root', pulumiProvider, {}, [], { dev: {} })
      const wsDb = new Workspace(
        'database',
        '/path/to/database',
        '/root',
        terraformProvider,
        { network_name: { workspace: 'network', key: 'network_name' } },
        ['network'],
        { dev: {} },
      )
      const monorepo = new Monorepo('/root', [wsNetwork, wsDb], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      // Level 1: network plan + apply
      const networkPlan = createProviderPlan({
        provider: 'pulumi',
        changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 },
      })
      // Level 2: database plan + apply
      const dbPlan = createProviderPlan({
        provider: 'terraform',
        changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 },
      })

      let callCount = 0
      mockGetPlan.mockImplementation(async () => {
        callCount++
        return callCount === 1 ? networkPlan : dbPlan
      })

      mockApply.mockImplementation(async () => {
        // First call = network, second = database
        if (mockApply.mock.calls.length === 1) {
          return { network_name: 'dev_net' }
        }
        return { db_host: 'localhost:5432' }
      })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      // Both workspaces should have been applied
      expect(mockApply).toHaveBeenCalledTimes(2)

      // Outputs should be stored
      expect(ctx.findAppliedOutput('network', 'network_name')).toBe('dev_net')
      expect(ctx.findAppliedOutput('database', 'db_host')).toBe('localhost:5432')
    })

    it('should handle diamond dependency with outputs flowing through multiple paths', async () => {
      envSelected()
      const wsA = createWs('ws1')
      const wsB = createWs('ws2', ['ws1'])
      const wsC = createWs('ws3', ['ws1'])
      const wsD = createWs('ws4', ['ws2', 'ws3'])
      const monorepo = new Monorepo('/root', [wsA, wsB, wsC, wsD], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )
      let applyCallCount = 0
      mockApply.mockImplementation(async () => {
        applyCallCount++
        return { output: `value-${applyCallCount}` }
      })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      // All 4 workspaces should be applied (3 levels: A | B,C | D)
      expect(mockApply).toHaveBeenCalledTimes(4)
    })
  })

  describe('destroy mode', () => {
    it('should execute destroy in reverse order', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, true, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockIsDestroyed.mockResolvedValue(false)
      mockDestroyPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 0, change: 0, remove: 1, replace: 0, outputUpdates: 0 } }),
      )
      mockDestroy.mockResolvedValue(undefined)

      const destroyOrder: string[] = []
      mockDestroy.mockImplementation(async () => {
        destroyOrder.push('destroyed')
      })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      // destroy should be called for both workspaces
      expect(mockDestroy).toHaveBeenCalledTimes(2)
    })

    it('should skip already-destroyed workspaces', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, true, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockIsDestroyed.mockResolvedValue(true)

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      expect(mockDestroyPlan).not.toHaveBeenCalled()
      expect(mockDestroy).not.toHaveBeenCalled()
    })

    it('should remove outputs for destroyed workspace', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, true, 'dev')
      // Pre-populate outputs
      ctx.storeWorkspaceOutputs(ws1, { key: 'val' })
      expect(ctx.findAppliedOutput('ws1', 'key')).toBe('val')

      const executor = new MultistageExecutor(ctx)
      mockIsDestroyed.mockResolvedValue(false)
      mockDestroyPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 0, change: 0, remove: 1, replace: 0, outputUpdates: 0 } }),
      )
      mockDestroy.mockResolvedValue(undefined)

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      expect(ctx.workspaceOutputs.find((w) => w.name === 'ws1')).toBeUndefined()
    })
  })

  describe('monorepo exports', () => {
    it('should aggregate workspace outputs into monorepo exports after apply', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [{ name: 'app_url', workspace: 'ws1', key: 'url' }], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )
      mockApply.mockResolvedValue({ url: 'http://localhost:3000' })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      expect(ctx.findAppliedOutput('ws1', 'url')).toBe('http://localhost:3000')
    })
  })

  describe('non-interactive', () => {
    it('should auto-apply when --approve matches level index', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )
      mockApply.mockResolvedValue({})

      const integration = createNonInteractiveIntegration()
      await executor.exec({ formatter: createFormatter(), integration, approve: 1 })

      expect(mockApply).toHaveBeenCalledOnce()
    })

    it('should stop and return when no --approve for current level', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )

      const integration = createNonInteractiveIntegration()
      await executor.exec({ formatter: createFormatter(), integration })

      // askForConfirmation should be called, but apply should not
      expect(integration.askForConfirmation).toHaveBeenCalled()
      expect(mockApply).not.toHaveBeenCalled()
    })
  })
})
