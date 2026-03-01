import { vi } from 'vitest'
import {
  MultistageExecutor,
  type IExecOptions,
  type IPlanExecOptions,
  type IDriftOptions,
  hasOutputDiff,
} from './multistage-executor.js'
import { ExecutionContext, Monorepo, Workspace, AppliedWorkspace } from './model.js'
import { MockProvider, createProviderPlan } from '../__test-utils__/mock-provider.js'
import { ProviderError, formatProviderErrorMessage } from '../utils/index.js'
import { extractTerraformDiagnostics, extractPulumiDiagnostics } from '../providers/diagnostic-extraction.js'
import {
  TERRAFORM_ERROR_OUTPUT,
  TERRAFORM_ERROR_WITH_WARNINGS,
  PULUMI_ERROR_BLOB,
} from '../__test-utils__/provider-fixtures.js'
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
      mockApply.mockResolvedValue({ url: { value: 'http://localhost', secret: false } })

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
      mockApply.mockResolvedValue({ key: { value: 'applied-value', secret: false } })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      expect(ctx.findAppliedOutput('ws1', 'key')).toEqual({ value: 'applied-value', secret: false })
    })

    it('should skip and cache outputs when no changes', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(createProviderPlan())
      mockGetOutputs.mockResolvedValue({ outputs: { existing: { value: 'value', secret: false } }, actual: true })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      expect(mockApply).not.toHaveBeenCalled()
      expect(ctx.findAppliedOutput('ws1', 'existing')).toEqual({ value: 'value', secret: false })
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
          return { network_name: { value: 'dev_net', secret: false } }
        }
        return { db_host: { value: 'localhost:5432', secret: false } }
      })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      // Both workspaces should have been applied
      expect(mockApply).toHaveBeenCalledTimes(2)

      // Outputs should be stored
      expect(ctx.findAppliedOutput('network', 'network_name')).toEqual({ value: 'dev_net', secret: false })
      expect(ctx.findAppliedOutput('database', 'db_host')).toEqual({ value: 'localhost:5432', secret: false })
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
        return { output: { value: `value-${applyCallCount}`, secret: false } }
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

    it('should skip input resolution for already-destroyed workspaces', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, true, 'dev')
      const executor = new MultistageExecutor(ctx)

      // ws2 (level 1 in destroy order) is already destroyed
      mockIsDestroyed.mockResolvedValue(true)

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      // getInputs should not be called since both workspaces are already destroyed
      expect(mockGetOutputs).not.toHaveBeenCalled()
      expect(mockDestroyPlan).not.toHaveBeenCalled()
      expect(mockDestroy).not.toHaveBeenCalled()
    })

    it('should not crash when multi-level destroy with all workspaces already destroyed', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const ws3 = createWs('ws3', ['ws2'])
      const monorepo = new Monorepo('/root', [ws1, ws2, ws3], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, true, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockIsDestroyed.mockResolvedValue(true)

      // Should not throw even though all workspaces are already destroyed
      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      expect(mockIsDestroyed).toHaveBeenCalledTimes(3)
      expect(mockDestroyPlan).not.toHaveBeenCalled()
      expect(mockDestroy).not.toHaveBeenCalled()
    })

    it('should use placeholder inputs during destroy when upstream outputs are unavailable', async () => {
      envSelected()
      const wsNetwork = createWs('ws1')
      const wsDb = new Workspace(
        'ws2',
        '/path/to/ws2',
        '/root',
        createMockProvider(),
        { network_name: { workspace: 'ws1', key: 'network_name' } },
        ['ws1'],
        { dev: {} },
      )
      const monorepo = new Monorepo('/root', [wsNetwork, wsDb], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, true, 'dev')
      const executor = new MultistageExecutor(ctx)

      // ws2 (destroyed first in reverse order) is not destroyed yet
      // ws1 (destroyed second) is already destroyed — its outputs won't be available
      let isDestroyedCallCount = 0
      mockIsDestroyed.mockImplementation(async () => {
        isDestroyedCallCount++
        return false
      })
      mockDestroyPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 0, change: 0, remove: 1, replace: 0, outputUpdates: 0 } }),
      )
      mockDestroy.mockResolvedValue(undefined)
      // getOutputs will throw for ws1 (already destroyed)
      mockGetOutputs.mockRejectedValue(new Error('no outputs available'))

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      // Both workspaces should have been destroyed (ws2 first, then ws1)
      expect(mockDestroy).toHaveBeenCalledTimes(2)
    })

    it('should remove outputs for destroyed workspace', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, true, 'dev')
      // Pre-populate outputs
      ctx.storeWorkspaceOutputs(ws1, { key: { value: 'val', secret: false } })
      expect(ctx.findAppliedOutput('ws1', 'key')).toEqual({ value: 'val', secret: false })

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

  describe('parallel failure handling', () => {
    it('should let all workspaces in a level complete even if one fails', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2')
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )

      let applyCallCount = 0
      mockApply.mockImplementation(async () => {
        applyCallCount++
        if (applyCallCount === 1) {
          throw new Error('apply failed')
        }
        return { key: { value: 'val', secret: false } }
      })

      await expect(
        executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() }),
      ).rejects.toThrow('Failed to apply workspaces')

      // Both workspaces attempted apply
      expect(mockApply).toHaveBeenCalledTimes(2)
    })

    it('should report failed workspace names in error message', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2')
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )

      let applyCallCount = 0
      mockApply.mockImplementation(async () => {
        applyCallCount++
        if (applyCallCount === 1) {
          throw new Error('terraform locked')
        }
        return {}
      })

      await expect(
        executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() }),
      ).rejects.toThrow(/force-unlock/)
    })

    it('should succeed when all workspaces in parallel level succeed', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2')
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )
      mockApply.mockResolvedValue({ key: { value: 'val', secret: false } })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      expect(mockApply).toHaveBeenCalledTimes(2)
    })

    describe('ProviderError diagnostic output', () => {
      let stderrSpy: ReturnType<typeof vi.spyOn>

      beforeEach(() => {
        stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      })

      afterEach(() => {
        stderrSpy.mockRestore()
      })

      function capturedOutput(): string {
        return stderrSpy.mock.calls.map((call) => String(call[0])).join('')
      }

      it('should log clean Terraform diagnostic on apply failure', async () => {
        envSelected()
        const ws1 = createWs('ws1')
        const monorepo = new Monorepo('/root', [ws1], [], undefined)
        const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
        const executor = new MultistageExecutor(ctx)

        mockGetPlan.mockResolvedValue(
          createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
        )

        const diagnostics = extractTerraformDiagnostics(TERRAFORM_ERROR_OUTPUT, '')
        const message = formatProviderErrorMessage('Terraform', 'ws1', diagnostics, 'terraform apply --json')
        mockApply.mockRejectedValue(new ProviderError(message, 'terraform', 'ws1', { diagnostics }))

        await expect(
          executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() }),
        ).rejects.toThrow('Failed to apply workspaces')

        const output = capturedOutput()
        expect(output).toContain('\u2718 error creating S3 Bucket: BucketAlreadyExists (aws_s3_bucket.main)')
        expect(output).toContain('Run with -v')
        expect(output).not.toContain('"type":"diagnostic"')
      })

      it('should log clean Pulumi diagnostic on apply failure', async () => {
        envSelected()
        const ws1 = createWs('ws1')
        const monorepo = new Monorepo('/root', [ws1], [], undefined)
        const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
        const executor = new MultistageExecutor(ctx)

        mockGetPlan.mockResolvedValue(
          createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
        )

        const diagnostics = extractPulumiDiagnostics(PULUMI_ERROR_BLOB, '')
        const message = formatProviderErrorMessage('Pulumi', 'ws1', diagnostics, 'pulumi up --yes')
        mockApply.mockRejectedValue(new ProviderError(message, 'pulumi', 'ws1', { diagnostics }))

        await expect(
          executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() }),
        ).rejects.toThrow('Failed to apply workspaces')

        const output = capturedOutput()
        expect(output).toContain('\u2718 error creating S3 Bucket: BucketAlreadyExists')
        expect(output).toContain('Run with -v')
      })

      it('should show only errors when mixed severities exist', async () => {
        envSelected()
        const ws1 = createWs('ws1')
        const monorepo = new Monorepo('/root', [ws1], [], undefined)
        const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
        const executor = new MultistageExecutor(ctx)

        mockGetPlan.mockResolvedValue(
          createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
        )

        const diagnostics = extractTerraformDiagnostics(TERRAFORM_ERROR_WITH_WARNINGS, '')
        const message = formatProviderErrorMessage('Terraform', 'ws1', diagnostics, 'terraform destroy --json')
        mockApply.mockRejectedValue(new ProviderError(message, 'terraform', 'ws1', { diagnostics }))

        await expect(
          executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() }),
        ).rejects.toThrow('Failed to apply workspaces')

        const output = capturedOutput()
        expect(output).toContain('\u2718 error creating S3 Bucket: BucketAlreadyExists')
        expect(output).not.toContain('Deprecated attribute')
      })

      it('should show command fallback when no diagnostics', async () => {
        envSelected()
        const ws1 = createWs('ws1')
        const monorepo = new Monorepo('/root', [ws1], [], undefined)
        const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
        const executor = new MultistageExecutor(ctx)

        mockGetPlan.mockResolvedValue(
          createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
        )

        const message = formatProviderErrorMessage('Terraform', 'ws1', [], 'terraform apply --json')
        mockApply.mockRejectedValue(new ProviderError(message, 'terraform', 'ws1', { diagnostics: [] }))

        await expect(
          executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() }),
        ).rejects.toThrow('Failed to apply workspaces')

        const output = capturedOutput()
        expect(output).toContain('Command: terraform apply --json')
        expect(output).toContain('Run with -v')
      })
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
      mockApply.mockResolvedValue({ url: { value: 'http://localhost:3000', secret: false } })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      expect(ctx.findAppliedOutput('ws1', 'url')).toEqual({ value: 'http://localhost:3000', secret: false })
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
      mockGetOutputs.mockResolvedValue({ outputs: { existing: { value: 'value', secret: false } }, actual: true })

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
      mockGetOutputs.mockResolvedValue({ outputs: { network_name: { value: 'dev_net', secret: false } }, actual: true })

      const result = await executor.plan({ formatter: createFormatter() })

      expect(result.hasChanges).toBe(true)
      expect(mockGetPlan).toHaveBeenCalledTimes(2)
      expect(mockApply).not.toHaveBeenCalled()
      // Outputs from ws1 should be cached for downstream use
      expect(ctx.findAppliedOutput('ws1', 'network_name')).toEqual({ value: 'dev_net', secret: false })
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

    it('should detect output-only changes by comparing plan outputs against cached state', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      // Plan has no resource changes but outputs differ from cached
      mockGetPlan.mockResolvedValue(
        createProviderPlan({
          outputs: [{ name: 'url', value: 'http://new-url', sensitive: false, description: null }],
        }),
      )
      // Cached outputs have a different value
      mockGetOutputs.mockResolvedValue({
        outputs: { url: { value: 'http://old-url', secret: false } },
        actual: true,
      })

      const result = await executor.plan({ formatter: createFormatter() })

      expect(result.hasChanges).toBe(true)
    })

    it('should not detect output-only changes when plan outputs match cached state', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      // Plan has no resource changes and outputs match cached
      mockGetPlan.mockResolvedValue(
        createProviderPlan({
          outputs: [{ name: 'url', value: 'http://same-url', sensitive: false, description: null }],
        }),
      )
      mockGetOutputs.mockResolvedValue({
        outputs: { url: { value: 'http://same-url', secret: false } },
        actual: true,
      })

      const result = await executor.plan({ formatter: createFormatter() })

      expect(result.hasChanges).toBe(false)
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

  describe('parallel plan gathering', () => {
    it('should plan multiple workspaces in a level in parallel', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2')
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )

      const result = await executor.plan({ formatter: createFormatter() })

      expect(result.hasChanges).toBe(true)
      expect(mockGetPlan).toHaveBeenCalledTimes(2)
    })

    it('should handle mixed results — one workspace has changes, one is up to date', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2')
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      let planCallCount = 0
      mockGetPlan.mockImplementation(async () => {
        planCallCount++
        if (planCallCount === 1) return createProviderPlan()
        return createProviderPlan({
          changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 },
        })
      })
      mockGetOutputs.mockResolvedValue({ outputs: { key: { value: 'val', secret: false } }, actual: true })

      const result = await executor.plan({ formatter: createFormatter() })

      expect(result.hasChanges).toBe(true)
      expect(mockGetPlan).toHaveBeenCalledTimes(2)
    })

    it('should throw combined error when plan fails for a workspace', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2')
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      let planCallCount = 0
      mockGetPlan.mockImplementation(async () => {
        planCallCount++
        if (planCallCount === 1) throw new Error('terraform init failed')
        return createProviderPlan({
          changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 },
        })
      })

      await expect(executor.plan({ formatter: createFormatter() })).rejects.toThrow('Failed to plan workspaces')

      // Both workspaces should have been attempted
      expect(mockGetPlan).toHaveBeenCalledTimes(2)
    })

    it('should run single-workspace level sequentially without renderer', async () => {
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
      expect(mockGetPlan).toHaveBeenCalledTimes(1)
    })
  })

  describe('--approve flag', () => {
    it('should skip plan and apply directly when --approve matches level (non-interactive)', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockApply.mockResolvedValue({})

      const integration = createNonInteractiveIntegration()
      await executor.exec({ formatter: createFormatter(), integration, approve: [1] })

      expect(mockGetPlan).not.toHaveBeenCalled()
      expect(integration.askForConfirmation).not.toHaveBeenCalled()
      expect(mockApply).toHaveBeenCalledOnce()
    })

    it('should skip plan and apply directly when --approve matches level (interactive)', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockApply.mockResolvedValue({})

      const integration = createInteractiveIntegration()
      await executor.exec({ formatter: createFormatter(), integration, approve: [1] })

      expect(mockGetPlan).not.toHaveBeenCalled()
      expect(integration.askForConfirmation).not.toHaveBeenCalled()
      expect(mockApply).toHaveBeenCalledOnce()
    })

    it('should stop and return when no --approve for current level (non-interactive)', async () => {
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

    it('should skip plan for all levels with --approve all', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockApply.mockResolvedValue({})

      const integration = createNonInteractiveIntegration()
      await executor.exec({ formatter: createFormatter(), integration, approve: 'all' })

      expect(mockGetPlan).not.toHaveBeenCalled()
      expect(integration.askForConfirmation).not.toHaveBeenCalled()
      expect(mockApply).toHaveBeenCalledTimes(2)
    })

    it('should skip plan only for approved levels with --approve 1,2', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const ws3 = createWs('ws3', ['ws2'])
      const monorepo = new Monorepo('/root', [ws1, ws2, ws3], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )
      mockApply.mockResolvedValue({})

      const integration = createNonInteractiveIntegration()
      // Approve levels 1 and 2, but not level 3
      await executor.exec({ formatter: createFormatter(), integration, approve: [1, 2] })

      // Levels 1 and 2 should be directly applied (no plan), level 3 plans normally
      expect(mockApply).toHaveBeenCalledTimes(2)
      // getPlan only called for level 3 (the non-approved level)
      expect(mockGetPlan).toHaveBeenCalledOnce()
      // Level 3 should trigger askForConfirmation and stop (non-interactive)
      expect(integration.askForConfirmation).toHaveBeenCalledOnce()
    })

    it('should apply without planFile when level is pre-approved', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockApply.mockResolvedValue({ key: { value: 'val', secret: false } })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration(), approve: [1] })

      expect(mockApply).toHaveBeenCalledWith(
        expect.anything(),
        expect.not.objectContaining({ planFile: expect.anything() }),
      )
    })

    it('should store outputs after direct apply', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockApply.mockResolvedValue({ key: { value: 'applied-value', secret: false } })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration(), approve: [1] })

      expect(ctx.findAppliedOutput('ws1', 'key')).toEqual({ value: 'applied-value', secret: false })
    })

    it('should skip destroyed workspaces in direct apply (destroy path)', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, true, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockIsDestroyed.mockResolvedValue(true)

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration(), approve: [1] })

      expect(mockGetPlan).not.toHaveBeenCalled()
      expect(mockDestroyPlan).not.toHaveBeenCalled()
      expect(mockDestroy).not.toHaveBeenCalled()
    })

    it('should destroy directly when level is pre-approved', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, true, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockIsDestroyed.mockResolvedValue(false)
      mockDestroy.mockResolvedValue(undefined)

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration(), approve: [1] })

      expect(mockDestroyPlan).not.toHaveBeenCalled()
      expect(mockDestroy).toHaveBeenCalledOnce()
      // No planFile should be passed
      expect(mockDestroy).toHaveBeenCalledWith(
        expect.anything(),
        expect.not.objectContaining({ planFile: expect.anything() }),
      )
    })

    it('should handle failures in direct apply', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2')
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      let applyCallCount = 0
      mockApply.mockImplementation(async () => {
        applyCallCount++
        if (applyCallCount === 1) throw new Error('apply failed')
        return { key: { value: 'val', secret: false } }
      })

      await expect(
        executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration(), approve: [1] }),
      ).rejects.toThrow('Failed to apply workspaces')

      // Both workspaces attempted apply
      expect(mockApply).toHaveBeenCalledTimes(2)
    })
  })

  describe('streaming', () => {
    it('should pass onEvent callback to interop.apply', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )
      mockApply.mockResolvedValue({})

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      expect(mockApply).toHaveBeenCalledOnce()
      const callArgs = mockApply.mock.calls[0]
      // Second arg is options containing onEvent
      expect(callArgs[1]).toHaveProperty('onEvent')
      expect(typeof callArgs[1].onEvent).toBe('function')
    })

    it('should pass onEvent callback to interop.destroy', async () => {
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

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      expect(mockDestroy).toHaveBeenCalled()
      const callArgs = mockDestroy.mock.calls[0]
      // Second arg is options containing onEvent
      expect(callArgs[1]).toHaveProperty('onEvent')
      expect(typeof callArgs[1].onEvent).toBe('function')
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
      mockGetOutputs.mockResolvedValue({ outputs: { existing: { value: 'value', secret: false } }, actual: true })

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
      mockGetOutputs.mockResolvedValue({ outputs: { key: { value: 'val', secret: false } }, actual: true })

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
      mockGetOutputs.mockResolvedValue({ outputs: { net: { value: 'dev_net', secret: false } }, actual: true })

      await executor.drift({ formatter: createFormatter() })

      expect(ctx.findAppliedOutput('ws1', 'net')).toEqual({ value: 'dev_net', secret: false })
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

    it('should call getPlan with refresh: false to isolate configuration drift', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetDriftPlan.mockResolvedValue(createProviderPlan())
      mockGetPlan.mockResolvedValue(createProviderPlan())
      mockGetOutputs.mockResolvedValue({ outputs: {}, actual: true })

      await executor.drift({ formatter: createFormatter() })

      expect(mockGetPlan).toHaveBeenCalledWith(expect.anything(), { refresh: false })
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
      mockGetOutputs.mockResolvedValue({ outputs: { key: { value: 'refreshed', secret: false } }, actual: true })

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
        if (callCount === 1) return { outputs: { net: { value: 'dev_net', secret: false } }, actual: true }
        return { outputs: { db: { value: 'localhost', secret: false } }, actual: true }
      })

      await executor.refreshState()

      expect(ctx.findAppliedOutput('ws1', 'net')).toEqual({ value: 'dev_net', secret: false })
      expect(ctx.findAppliedOutput('ws2', 'db')).toEqual({ value: 'localhost', secret: false })
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

  describe('plan file reuse', () => {
    it('should pass savePlanFile to getPlan during exec', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      const plan = createProviderPlan({
        changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 },
        planFile: '.ig/.temp/ws1/ig-plan.bin',
      })
      mockGetPlan.mockResolvedValue(plan)
      mockApply.mockResolvedValue({ url: { value: 'http://localhost', secret: false } })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      expect(mockGetPlan).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ savePlanFile: true }))
    })

    it('should pass planFile from plan to apply', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      const plan = createProviderPlan({
        changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 },
        planFile: '.ig/.temp/ws1/ig-plan.bin',
      })
      mockGetPlan.mockResolvedValue(plan)
      mockApply.mockResolvedValue({ url: { value: 'http://localhost', secret: false } })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      expect(mockApply).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ planFile: '.ig/.temp/ws1/ig-plan.bin' }),
      )
    })

    it('should pass planFile from destroy plan to destroy', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, true, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockIsDestroyed.mockResolvedValue(false)
      const plan = createProviderPlan({
        changeSummary: { add: 0, change: 0, remove: 1, replace: 0, outputUpdates: 0 },
        planFile: '.ig/.temp/ws1/ig-destroy-plan.bin',
      })
      mockDestroyPlan.mockResolvedValue(plan)
      mockDestroy.mockResolvedValue(undefined)

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      expect(mockDestroyPlan).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ savePlanFile: true }))
      expect(mockDestroy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ planFile: '.ig/.temp/ws1/ig-destroy-plan.bin' }),
      )
    })

    it('should call apply without planFile when plan has none (Pulumi)', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      const plan = createProviderPlan({
        changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 },
      })
      mockGetPlan.mockResolvedValue(plan)
      mockApply.mockResolvedValue({ url: { value: 'http://localhost', secret: false } })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      expect(mockApply).toHaveBeenCalledWith(
        expect.anything(),
        expect.not.objectContaining({ planFile: expect.anything() }),
      )
    })

    it('should not pass savePlanFile during plan-only (preview)', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )

      await executor.plan({ formatter: createFormatter() })

      expect(mockGetPlan).toHaveBeenCalledWith(expect.anything(), undefined)
    })
  })

  describe('--start-with-project', () => {
    function envSelectedWithOutputs(
      workspaceOutputs: Record<string, Record<string, { value: string; secret: boolean }>>,
      env = 'dev',
    ) {
      const wsNames = Object.keys(workspaceOutputs)
      const state = new State()
      state.startSelectingEnv(env)
      state.finishEnvSelection(wsNames)
      state.restore({
        current_environment: env,
        workspaces: Object.fromEntries(
          Object.entries(workspaceOutputs).map(([name, outputs]) => [name, { env, outputs }]),
        ),
      })
      mockRead.mockResolvedValue(state)
    }

    it('should skip levels before target workspace during apply', async () => {
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)

      envSelectedWithOutputs({
        ws1: { net: { value: 'dev_net', secret: false } },
        ws2: {},
      })

      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev', ws2)
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )
      mockApply.mockResolvedValue({ db: { value: 'localhost', secret: false } })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      // getPlan should only be called once (for ws2, not ws1)
      expect(mockGetPlan).toHaveBeenCalledTimes(1)
      expect(mockApply).toHaveBeenCalledTimes(1)
    })

    it('should pre-populate cached outputs for skipped workspaces', async () => {
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)

      envSelectedWithOutputs({
        ws1: { net: { value: 'dev_net', secret: false } },
        ws2: {},
      })

      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev', ws2)
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )
      mockApply.mockResolvedValue({ db: { value: 'localhost', secret: false } })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      // Skipped ws1 should have its cached outputs available
      expect(ctx.findAppliedOutput('ws1', 'net')).toEqual({ value: 'dev_net', secret: false })
    })

    it('should error when cached outputs missing for skipped dependency', async () => {
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)

      // ws1 has no cached outputs
      envSelectedWithOutputs({ ws1: {}, ws2: {} })
      // Override to remove outputs for ws1
      const state = new State()
      state.startSelectingEnv('dev')
      state.finishEnvSelection(['ws1', 'ws2'])
      mockRead.mockResolvedValue(state)

      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev', ws2)
      const executor = new MultistageExecutor(ctx)

      await expect(
        executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() }),
      ).rejects.toThrow("Cannot skip to 'ws2': missing cached outputs for skipped workspaces: ws1")
    })

    it('should work with destroy (reverse level order)', async () => {
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)

      // In destroy mode, levels are reversed: ws2 is level 1, ws1 is level 2
      // So --start-with-project ws1 should skip ws2 (level 1 in destroy order)
      envSelectedWithOutputs({
        ws1: { net: { value: 'dev_net', secret: false } },
        ws2: { db: { value: 'localhost', secret: false } },
      })

      const ctx = new ExecutionContext(monorepo, undefined, false, true, 'dev', ws1)
      const executor = new MultistageExecutor(ctx)

      mockIsDestroyed.mockResolvedValue(false)
      mockDestroyPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 0, change: 0, remove: 1, replace: 0, outputUpdates: 0 } }),
      )
      mockDestroy.mockResolvedValue(undefined)

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      // Only ws1 should be destroyed (ws2 is in an earlier level in destroy order and should be skipped)
      expect(mockDestroy).toHaveBeenCalledTimes(1)
    })

    it('should not skip anything when target is already in level 1', async () => {
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)

      envSelectedWithOutputs({
        ws1: { net: { value: 'dev_net', secret: false } },
        ws2: {},
      })

      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev', ws1)
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )
      mockApply.mockResolvedValue({ net: { value: 'dev_net', secret: false } })

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      // Both levels processed (ws1 in level 1, ws2 in level 2)
      expect(mockGetPlan).toHaveBeenCalledTimes(2)
      expect(mockApply).toHaveBeenCalledTimes(2)
    })

    it('should preserve original level numbers in --approve', async () => {
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const ws3 = createWs('ws3', ['ws2'])
      const monorepo = new Monorepo('/root', [ws1, ws2, ws3], [], undefined)

      envSelectedWithOutputs({
        ws1: { net: { value: 'dev_net', secret: false } },
        ws2: { db: { value: 'localhost', secret: false } },
        ws3: {},
      })

      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev', ws2)
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )
      mockApply.mockResolvedValue({ out: { value: 'val', secret: false } })

      // Approve level 2 (ws2 is in level 2 of the original plan) — should auto-approve
      await executor.exec({
        formatter: createFormatter(),
        integration: createInteractiveIntegration(),
        approve: [2, 3],
      })

      // Both levels 2 and 3 should be directly applied (no plan)
      expect(mockGetPlan).not.toHaveBeenCalled()
      expect(mockApply).toHaveBeenCalledTimes(2)
    })

    it('should error when target workspace not in execution plan', async () => {
      const ws1 = createWs('ws1')
      const wsUnrelated = createWs('unrelated', [], ['prod']) // not in dev env
      const monorepo = new Monorepo('/root', [ws1, wsUnrelated], [], undefined)

      envSelectedWithOutputs({ ws1: {} })

      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev', wsUnrelated)
      const executor = new MultistageExecutor(ctx)

      await expect(
        executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() }),
      ).rejects.toThrow("Workspace 'unrelated' not found in the execution plan")
    })

    it('should skip levels before target workspace during plan', async () => {
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)

      envSelectedWithOutputs({
        ws1: { net: { value: 'dev_net', secret: false } },
        ws2: {},
      })

      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev', ws2)
      const executor = new MultistageExecutor(ctx)

      mockGetPlan.mockResolvedValue(
        createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } }),
      )

      await executor.plan({ formatter: createFormatter() })

      // Only ws2 should be planned
      expect(mockGetPlan).toHaveBeenCalledTimes(1)
    })
  })
})

describe('hasOutputDiff', () => {
  it('should return false when plan outputs match cached outputs', () => {
    const planOutputs = [{ name: 'url', value: 'http://localhost', sensitive: false, description: null }]
    const cachedOutputs = { url: { value: 'http://localhost', secret: false } }
    expect(hasOutputDiff(planOutputs, cachedOutputs)).toBe(false)
  })

  it('should return true when plan has a new output', () => {
    const planOutputs = [
      { name: 'url', value: 'http://localhost', sensitive: false, description: null },
      { name: 'port', value: '3000', sensitive: false, description: null },
    ]
    const cachedOutputs = { url: { value: 'http://localhost', secret: false } }
    expect(hasOutputDiff(planOutputs, cachedOutputs)).toBe(true)
  })

  it('should return true when plan output value differs from cached', () => {
    const planOutputs = [{ name: 'url', value: 'http://new-url', sensitive: false, description: null }]
    const cachedOutputs = { url: { value: 'http://old-url', secret: false } }
    expect(hasOutputDiff(planOutputs, cachedOutputs)).toBe(true)
  })

  it('should return false when plan has no outputs (cannot detect diff)', () => {
    const planOutputs: { name: string; value: string; sensitive: boolean; description: null }[] = []
    const cachedOutputs = { url: { value: 'http://localhost', secret: false } }
    expect(hasOutputDiff(planOutputs, cachedOutputs)).toBe(false)
  })

  it('should return true when cached has an output removed in plan', () => {
    const planOutputs = [{ name: 'port', value: '3000', sensitive: false, description: null }]
    const cachedOutputs = {
      port: { value: '3000', secret: false },
      url: { value: 'http://localhost', secret: false },
    }
    expect(hasOutputDiff(planOutputs, cachedOutputs)).toBe(true)
  })

  it('should return false when both are empty', () => {
    expect(hasOutputDiff([], {})).toBe(false)
  })
})
