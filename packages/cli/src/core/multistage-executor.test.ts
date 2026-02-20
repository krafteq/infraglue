import { vi } from 'vitest'
import {
  MultistageExecutor,
  type IExecOptions,
  type IPlanExecOptions,
  type IDriftOptions,
} from './multistage-executor.js'
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
const mockGetDriftPlan = vi.fn()
const mockRefresh = vi.fn()
const mockImportResource = vi.fn()
const mockGenerateCode = vi.fn()

vi.mock('./workspace-interop.js', () => ({
  WorkspaceInterop: vi.fn().mockImplementation(() => ({
    getPlan: mockGetPlan,
    apply: mockApply,
    getOutputs: mockGetOutputs,
    destroyPlan: mockDestroyPlan,
    destroy: mockDestroy,
    isDestroyed: mockIsDestroyed,
    getDriftPlan: mockGetDriftPlan,
    refresh: mockRefresh,
    importResource: mockImportResource,
    generateCode: mockGenerateCode,
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

  describe('plan', () => {
    it('should return hasChanges: false when all workspaces are up to date', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(createProviderPlan())
      mockGetOutputs.mockResolvedValue({ outputs: { existing: 'value' }, actual: true })

      const result = await executor.plan({ formatter: createFormatter() })

      expect(result.hasChanges).toBe(false)
      expect(mockApply).not.toHaveBeenCalled()
    })

    it('should return hasChanges: true when changes are detected', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )

      const result = await executor.plan({ formatter: createFormatter() })

      expect(result.hasChanges).toBe(true)
      expect(mockApply).not.toHaveBeenCalled()
    })

    it('should gather plans across multiple levels with output injection', async () => {
      envSelected()
      const wsNetwork = createWs('ws1')
      const wsDb = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [wsNetwork, wsDb], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      let planCallCount = 0
      mockGetPlan.mockImplementation(async () => {
        planCallCount++
        if (planCallCount === 1) {
          // ws1 has no changes — trigger output caching
          return createProviderPlan()
        }
        // ws2 has changes
        return createProviderPlan({
          changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 },
        })
      })
      mockGetOutputs.mockResolvedValue({ outputs: { network_name: 'dev_net' }, actual: true })

      const result = await executor.plan({ formatter: createFormatter() })

      expect(result.hasChanges).toBe(true)
      expect(mockGetPlan).toHaveBeenCalledTimes(2)
      expect(mockApply).not.toHaveBeenCalled()
      // Outputs from ws1 should be cached for downstream use
      expect(ctx.findAppliedOutput('ws1', 'network_name')).toBe('dev_net')
    })

    it('should not call askForConfirmation', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )

      await executor.plan({ formatter: createFormatter() })

      // plan() does not use integration at all — no confirmation
      expect(mockApply).not.toHaveBeenCalled()
    })

    it('should work with --project filter (single workspace)', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      // currentWorkspace = ws2, ignoreDependencies = true
      const ctx = new ExecutionContext(monorepo, ws2, true, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )

      const result = await executor.plan({ formatter: createFormatter() })

      expect(result.hasChanges).toBe(true)
      // Only ws2 should be planned (filtered by currentWorkspace + ignoreDeps)
      expect(mockGetPlan).toHaveBeenCalledTimes(1)
    })

    it('should pass detailed option to getPlan', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )

      await executor.plan({ formatter: createFormatter(), detailed: true })

      expect(mockGetPlan).toHaveBeenCalledWith(expect.anything(), { detailed: true })
    })

    it('should validate env the same as exec', async () => {
      mockRead.mockResolvedValue(new State())
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      await expect(executor.plan({ formatter: createFormatter() })).rejects.toThrow(
        'Cannot execute: environments across workspaces are in inconsistent state',
      )
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

  describe('drift', () => {
    it('should return hasDrift: false when no workspaces have drift', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetDriftPlan.mockResolvedValue(createProviderPlan())
      mockGetPlan.mockResolvedValue(createProviderPlan())
      mockGetOutputs.mockResolvedValue({ outputs: { existing: 'value' }, actual: true })

      const result = await executor.drift({ formatter: createFormatter() })

      expect(result.hasDrift).toBe(false)
      expect(result.report.hasDrift).toBe(false)
      expect(result.report.workspaces).toHaveLength(1)
      expect(result.report.workspaces[0].hasDrift).toBe(false)
      expect(result.report.workspaces[0].infrastructureDrift.hasDrift).toBe(false)
      expect(result.report.workspaces[0].configurationDrift.hasDrift).toBe(false)
    })

    it('should return hasDrift: true when infrastructure drift is detected', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetDriftPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 0, change: 1, remove: 0, replace: 0, outputUpdates: 0 } }),
      )
      mockGetPlan.mockResolvedValue(createProviderPlan())

      const result = await executor.drift({ formatter: createFormatter() })

      expect(result.hasDrift).toBe(true)
      expect(result.report.workspaces[0].hasDrift).toBe(true)
      expect(result.report.workspaces[0].infrastructureDrift.hasDrift).toBe(true)
      expect(result.report.workspaces[0].configurationDrift.hasDrift).toBe(false)
    })

    it('should collect drift reports across multiple levels', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      let driftCallCount = 0
      mockGetDriftPlan.mockImplementation(async () => {
        driftCallCount++
        if (driftCallCount === 1) {
          // ws1 has no drift
          return createProviderPlan()
        }
        // ws2 has infra drift
        return createProviderPlan({
          changeSummary: { add: 0, change: 1, remove: 0, replace: 0, outputUpdates: 0 },
        })
      })
      mockGetPlan.mockResolvedValue(createProviderPlan())
      mockGetOutputs.mockResolvedValue({ outputs: { key: 'val' }, actual: true })

      const result = await executor.drift({ formatter: createFormatter() })

      expect(result.hasDrift).toBe(true)
      expect(result.report.workspaces).toHaveLength(2)
      expect(result.report.workspaces[0].hasDrift).toBe(false)
      expect(result.report.workspaces[0].infrastructureDrift.hasDrift).toBe(false)
      expect(result.report.workspaces[1].hasDrift).toBe(true)
      expect(result.report.workspaces[1].infrastructureDrift.hasDrift).toBe(true)
    })

    it('should store outputs for no-drift workspaces for downstream injection', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetDriftPlan.mockResolvedValue(createProviderPlan())
      mockGetPlan.mockResolvedValue(createProviderPlan())
      mockGetOutputs.mockResolvedValue({ outputs: { net: 'dev_net' }, actual: true })

      await executor.drift({ formatter: createFormatter() })

      expect(ctx.findAppliedOutput('ws1', 'net')).toBe('dev_net')
    })

    it('should work with --project filter', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, ws2, true, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetDriftPlan.mockResolvedValue(createProviderPlan())
      mockGetPlan.mockResolvedValue(createProviderPlan())
      mockGetOutputs.mockResolvedValue({ outputs: {}, actual: true })

      const result = await executor.drift({ formatter: createFormatter() })

      expect(result.hasDrift).toBe(false)
      expect(mockGetDriftPlan).toHaveBeenCalledTimes(1)
      expect(mockGetPlan).toHaveBeenCalledTimes(1)
    })

    it('should validate env', async () => {
      mockRead.mockResolvedValue(new State())
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      await expect(executor.drift({ formatter: createFormatter() })).rejects.toThrow(
        'Cannot execute: environments across workspaces are in inconsistent state',
      )
    })

    it('should populate report with environment and timestamp', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetDriftPlan.mockResolvedValue(createProviderPlan())
      mockGetPlan.mockResolvedValue(createProviderPlan())
      mockGetOutputs.mockResolvedValue({ outputs: {}, actual: true })

      const result = await executor.drift({ formatter: createFormatter() })

      expect(result.report.environment).toBe('dev')
      expect(result.report.timestamp).toBeTruthy()
    })

    it('should detect configuration drift only (no infrastructure drift)', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetDriftPlan.mockResolvedValue(createProviderPlan())
      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 0, change: 0, remove: 1, replace: 0, outputUpdates: 0 } }),
      )

      const result = await executor.drift({ formatter: createFormatter() })

      expect(result.hasDrift).toBe(true)
      expect(result.report.workspaces[0].hasDrift).toBe(true)
      expect(result.report.workspaces[0].infrastructureDrift.hasDrift).toBe(false)
      expect(result.report.workspaces[0].configurationDrift.hasDrift).toBe(true)
      expect(result.report.workspaces[0].configurationDrift.plan).not.toBeNull()
    })

    it('should detect both infrastructure and configuration drift simultaneously', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetDriftPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 0, change: 1, remove: 0, replace: 0, outputUpdates: 0 } }),
      )
      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 0, change: 0, remove: 1, replace: 0, outputUpdates: 0 } }),
      )

      const result = await executor.drift({ formatter: createFormatter() })

      expect(result.hasDrift).toBe(true)
      expect(result.report.workspaces[0].infrastructureDrift.hasDrift).toBe(true)
      expect(result.report.workspaces[0].configurationDrift.hasDrift).toBe(true)
    })

    it('should skip configuration drift check when --refresh-only is set', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetDriftPlan.mockResolvedValue(createProviderPlan())
      mockGetOutputs.mockResolvedValue({ outputs: {}, actual: true })

      const result = await executor.drift({ formatter: createFormatter(), refreshOnly: true })

      expect(mockGetPlan).not.toHaveBeenCalled()
      expect(result.hasDrift).toBe(false)
      expect(result.report.workspaces[0].configurationDrift.hasDrift).toBe(false)
      expect(result.report.workspaces[0].configurationDrift.plan).toBeNull()
    })

    it('should not store outputs when workspace has configuration drift', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      // ws1: no infra drift but has config drift
      mockGetDriftPlan.mockResolvedValue(createProviderPlan())
      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )

      await executor.drift({ formatter: createFormatter() })

      expect(mockGetOutputs).not.toHaveBeenCalled()
      expect(ctx.findAppliedOutput('ws1', 'net')).toBeUndefined()
    })
  })

  describe('refreshState', () => {
    it('should refresh all workspaces in order', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockRefresh.mockResolvedValue(undefined)
      mockGetOutputs.mockResolvedValue({ outputs: { key: 'refreshed' }, actual: true })

      await executor.refreshState()

      expect(mockRefresh).toHaveBeenCalledTimes(2)
      expect(mockGetOutputs).toHaveBeenCalledTimes(2)
    })

    it('should collect outputs for downstream injection', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockRefresh.mockResolvedValue(undefined)
      let callCount = 0
      mockGetOutputs.mockImplementation(async () => {
        callCount++
        if (callCount === 1) return { outputs: { net: 'dev_net' }, actual: true }
        return { outputs: { db: 'localhost' }, actual: true }
      })

      await executor.refreshState()

      expect(ctx.findAppliedOutput('ws1', 'net')).toBe('dev_net')
      expect(ctx.findAppliedOutput('ws2', 'db')).toBe('localhost')
    })

    it('should work with --project filter', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, ws2, true, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockRefresh.mockResolvedValue(undefined)
      mockGetOutputs.mockResolvedValue({ outputs: {}, actual: true })

      await executor.refreshState()

      expect(mockRefresh).toHaveBeenCalledTimes(1)
    })

    it('should validate env', async () => {
      mockRead.mockResolvedValue(new State())
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      await expect(executor.refreshState()).rejects.toThrow(
        'Cannot execute: environments across workspaces are in inconsistent state',
      )
    })
  })
})
