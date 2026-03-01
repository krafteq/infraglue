import { vi } from 'vitest'
import { MultistageExecutor } from './multistage-executor.js'
import { ExecutionContext, Monorepo, Workspace } from './model.js'
import { MockProvider, createProviderPlan } from '../__test-utils__/mock-provider.js'
import {
  TERRAFORM_APPLY_START,
  TERRAFORM_APPLY_COMPLETE,
  TERRAFORM_APPLY_ERRORED,
  TERRAFORM_STREAM_SUMMARY,
  TERRAFORM_STREAM_DIAGNOSTIC,
  TERRAFORM_APPLY_PROGRESS,
  PULUMI_RESOURCE_PRE,
  PULUMI_RES_OUTPUTS,
  PULUMI_STREAM_SUMMARY,
  PULUMI_RES_OP_FAILED,
  PULUMI_STREAM_DIAGNOSTIC,
} from '../__test-utils__/provider-fixtures.js'
import { parseTerraformStreamLine, parsePulumiStreamLine } from '../providers/stream-parser.js'
import { State } from './state-manager.js'
import type { IIntegration } from '../integrations/integration.js'
import type { IFormatter } from '../formatters/formatter.js'
import type { ProviderEvent, ProviderInput, ProviderOutput } from '../providers/index.js'

// Mock StateManager
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

// --- Helpers ---

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

function envSelected(env = 'dev') {
  const state = new State()
  state.startSelectingEnv(env)
  state.finishEnvSelection(['ws1', 'ws2', 'ws3', 'ws4', 'redis', 'postgres', 'network', 'database'])
  mockRead.mockResolvedValue(state)
}

function planWithChanges(overrides: { add?: number; change?: number; remove?: number } = {}) {
  return createProviderPlan({
    changeSummary: {
      add: overrides.add ?? 1,
      change: overrides.change ?? 0,
      remove: overrides.remove ?? 0,
      replace: 0,
      outputUpdates: 0,
    },
  })
}

function mockApplyWithEvents(events: ProviderEvent[], outputs: ProviderOutput = {}) {
  return async (_input: ProviderInput, options?: { onEvent?: (event: ProviderEvent) => void }) => {
    for (const event of events) {
      options?.onEvent?.(event)
    }
    return outputs
  }
}

function mockDestroyWithEvents(events: ProviderEvent[]) {
  return async (_input: ProviderInput, options?: { onEvent?: (event: ProviderEvent) => void }) => {
    for (const event of events) {
      options?.onEvent?.(event)
    }
  }
}

function capturedStderr(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call) => String(call[0])).join('')
}

// --- Tests ---

describe('MultistageExecutor e2e — streaming output', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdate.mockImplementation(async (fn) => fn(new State()))
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stderrSpy.mockRestore()
  })

  describe('non-TTY streaming output', () => {
    it('single workspace apply — resource lifecycle lines', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      const events: ProviderEvent[] = [
        { type: 'resource_start', address: 'docker_network.main', resourceType: 'docker_network', action: 'create' },
        { type: 'resource_complete', address: 'docker_network.main', action: 'create', elapsedSeconds: 12 },
        { type: 'summary', add: 2, change: 0, remove: 0 },
      ]

      mockGetPlan.mockResolvedValue(planWithChanges())
      mockApply.mockImplementation(mockApplyWithEvents(events))

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      const output = capturedStderr(stderrSpy)
      expect(output).toContain('[ws1] create docker_network.main')
      expect(output).toContain('[ws1] create docker_network.main (12s)')
      expect(output).toContain('[ws1] summary: +2 ~0 -0')
    })

    it('multi-workspace parallel apply — interleaved output', async () => {
      envSelected()
      const redis = createWs('redis')
      const postgres = createWs('postgres')
      const monorepo = new Monorepo('/root', [redis, postgres], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      const redisEvents: ProviderEvent[] = [
        {
          type: 'resource_start',
          address: 'docker_container.redis',
          resourceType: 'docker_container',
          action: 'create',
        },
        { type: 'resource_complete', address: 'docker_container.redis', action: 'create', elapsedSeconds: 5 },
      ]
      const postgresEvents: ProviderEvent[] = [
        {
          type: 'resource_start',
          address: 'docker_container.postgres',
          resourceType: 'docker_container',
          action: 'create',
        },
        { type: 'resource_complete', address: 'docker_container.postgres', action: 'create', elapsedSeconds: 8 },
      ]

      let callCount = 0
      mockGetPlan.mockResolvedValue(planWithChanges())
      mockApply.mockImplementation(
        async (input: ProviderInput, options?: { onEvent?: (event: ProviderEvent) => void }) => {
          callCount++
          const events = callCount === 1 ? redisEvents : postgresEvents
          for (const event of events) {
            options?.onEvent?.(event)
          }
          return {}
        },
      )

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      const output = capturedStderr(stderrSpy)
      expect(output).toContain('[redis]')
      expect(output).toContain('[postgres]')
      // Should NOT contain old-style messages
      expect(output).not.toContain('Applying redis...')
      expect(output).not.toContain('✅ redis applied successfully')
    })

    it('multi-workspace with error — error lines alongside success', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2')
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      const ws1Events: ProviderEvent[] = [
        { type: 'resource_start', address: 'docker_network.main', resourceType: 'docker_network', action: 'create' },
        { type: 'resource_complete', address: 'docker_network.main', action: 'create', elapsedSeconds: 3 },
      ]
      const ws2Events: ProviderEvent[] = [
        { type: 'resource_start', address: 'docker_container.app', resourceType: 'docker_container', action: 'create' },
        { type: 'resource_error', address: 'docker_container.app', message: 'image not found' },
      ]

      let callCount = 0
      mockGetPlan.mockResolvedValue(planWithChanges())
      mockApply.mockImplementation(
        async (input: ProviderInput, options?: { onEvent?: (event: ProviderEvent) => void }) => {
          callCount++
          if (callCount === 1) {
            for (const event of ws1Events) options?.onEvent?.(event)
            return {}
          }
          for (const event of ws2Events) options?.onEvent?.(event)
          throw new Error('apply failed: image not found')
        },
      )

      await expect(
        executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() }),
      ).rejects.toThrow('Failed to apply workspaces: ws2')

      const output = capturedStderr(stderrSpy)
      expect(output).toContain('[ws1] create docker_network.main (3s)')
      expect(output).toContain('[ws2] error: docker_container.app - image not found')
    })

    it('destroy with streaming events', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, true, 'dev') // isDestroy=true
      const executor = new MultistageExecutor(ctx)

      const ws2Events: ProviderEvent[] = [
        { type: 'resource_start', address: 'docker_container.app', resourceType: 'docker_container', action: 'delete' },
        { type: 'resource_complete', address: 'docker_container.app', action: 'delete', elapsedSeconds: 2 },
      ]
      const ws1Events: ProviderEvent[] = [
        { type: 'resource_start', address: 'docker_network.main', resourceType: 'docker_network', action: 'delete' },
        { type: 'resource_complete', address: 'docker_network.main', action: 'delete', elapsedSeconds: 1 },
      ]

      mockIsDestroyed.mockResolvedValue(false)

      let destroyCallCount = 0
      mockDestroyPlan.mockResolvedValue(planWithChanges({ remove: 1, add: 0 }))
      mockDestroy.mockImplementation(
        async (input: ProviderInput, options?: { onEvent?: (event: ProviderEvent) => void }) => {
          destroyCallCount++
          // Destroy is reverse order: ws2 first (level 1 in destroy), ws1 second (level 2 in destroy)
          const events = destroyCallCount === 1 ? ws2Events : ws1Events
          for (const event of events) options?.onEvent?.(event)
        },
      )

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      const output = capturedStderr(stderrSpy)
      expect(output).toContain('[ws2]')
      expect(output).toContain('[ws1]')
    })

    it('multi-level sequential flow — level 1 events then level 2 events', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const ws2 = createWs('ws2', ['ws1'])
      const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      const ws1Events: ProviderEvent[] = [
        { type: 'resource_start', address: 'docker_network.main', resourceType: 'docker_network', action: 'create' },
        { type: 'resource_complete', address: 'docker_network.main', action: 'create', elapsedSeconds: 5 },
      ]
      const ws2Events: ProviderEvent[] = [
        { type: 'resource_start', address: 'docker_container.app', resourceType: 'docker_container', action: 'create' },
        { type: 'resource_complete', address: 'docker_container.app', action: 'create', elapsedSeconds: 8 },
      ]

      let planCallCount = 0
      mockGetPlan.mockImplementation(async () => {
        planCallCount++
        return planWithChanges()
      })

      let applyCallCount = 0
      mockApply.mockImplementation(
        async (input: ProviderInput, options?: { onEvent?: (event: ProviderEvent) => void }) => {
          applyCallCount++
          const events = applyCallCount === 1 ? ws1Events : ws2Events
          for (const event of events) options?.onEvent?.(event)
          if (applyCallCount === 1) return { network_name: { value: 'dev_net', secret: false } }
          return {}
        },
      )

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      const output = capturedStderr(stderrSpy)

      // Both workspace outputs present
      expect(output).toContain('[ws1] create docker_network.main')
      expect(output).toContain('[ws2] create docker_container.app')

      // ws1 lines should appear before ws2 lines (sequential levels)
      const ws1Pos = output.indexOf('[ws1] create docker_network.main')
      const ws2Pos = output.indexOf('[ws2] create docker_container.app')
      expect(ws1Pos).toBeLessThan(ws2Pos)
    })

    it('diagnostic events appear in output', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      const events: ProviderEvent[] = [
        { type: 'diagnostic', severity: 'warning', summary: 'Deprecated attribute', detail: '', address: null },
        { type: 'resource_start', address: 'docker_network.main', resourceType: 'docker_network', action: 'create' },
        { type: 'resource_complete', address: 'docker_network.main', action: 'create', elapsedSeconds: 1 },
      ]

      mockGetPlan.mockResolvedValue(planWithChanges())
      mockApply.mockImplementation(mockApplyWithEvents(events))

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      const output = capturedStderr(stderrSpy)
      expect(output).toContain('[ws1] warning: Deprecated attribute')
    })

    it('progress events are skipped in non-TTY', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      const events: ProviderEvent[] = [
        { type: 'resource_start', address: 'docker_network.main', resourceType: 'docker_network', action: 'create' },
        { type: 'resource_progress', address: 'docker_network.main', elapsedSeconds: 10 },
        { type: 'resource_complete', address: 'docker_network.main', action: 'create', elapsedSeconds: 12 },
      ]

      mockGetPlan.mockResolvedValue(planWithChanges())
      mockApply.mockImplementation(mockApplyWithEvents(events))

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      const output = capturedStderr(stderrSpy)
      // resource_start and resource_complete should be present
      expect(output).toContain('[ws1] create docker_network.main\n')
      expect(output).toContain('[ws1] create docker_network.main (12s)')
      // No progress line should appear (NonTtyRenderer skips resource_progress)
      expect(output).not.toContain('10s')
      expect(output).not.toMatch(/\[ws1\].*Still creating/)
    })
  })

  describe('streaming with real provider fixtures', () => {
    it('Terraform fixture → non-TTY output', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      const events = [
        parseTerraformStreamLine(TERRAFORM_APPLY_START),
        parseTerraformStreamLine(TERRAFORM_APPLY_COMPLETE),
        parseTerraformStreamLine(TERRAFORM_STREAM_SUMMARY),
      ].filter((e): e is ProviderEvent => e !== null)

      expect(events).toHaveLength(3)

      mockGetPlan.mockResolvedValue(planWithChanges())
      mockApply.mockImplementation(mockApplyWithEvents(events))

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      const output = capturedStderr(stderrSpy)
      expect(output).toContain('[ws1] create docker_network.main')
      expect(output).toContain('[ws1] create docker_network.main (12s)')
      expect(output).toContain('[ws1] summary: +2 ~0 -0')
    })

    it('Pulumi fixture → non-TTY output', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      const events = [
        parsePulumiStreamLine(PULUMI_RESOURCE_PRE),
        parsePulumiStreamLine(PULUMI_RES_OUTPUTS),
        parsePulumiStreamLine(PULUMI_STREAM_SUMMARY),
      ].filter((e): e is ProviderEvent => e !== null)

      expect(events).toHaveLength(3)

      mockGetPlan.mockResolvedValue(planWithChanges())
      mockApply.mockImplementation(mockApplyWithEvents(events))

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      const output = capturedStderr(stderrSpy)
      // Pulumi addresses use URNs
      expect(output).toContain('[ws1] create urn:pulumi:dev::network::docker:index/network:Network::dev-network')
      expect(output).toContain('(12s)')
      expect(output).toContain('[ws1] summary: +2 ~1 -0')
    })

    it('Terraform error fixture → error output', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      const events = [
        parseTerraformStreamLine(TERRAFORM_APPLY_START),
        parseTerraformStreamLine(TERRAFORM_APPLY_ERRORED),
      ].filter((e): e is ProviderEvent => e !== null)

      expect(events).toHaveLength(2)

      mockGetPlan.mockResolvedValue(planWithChanges())
      mockApply.mockImplementation(
        async (_input: ProviderInput, options?: { onEvent?: (event: ProviderEvent) => void }) => {
          for (const event of events) options?.onEvent?.(event)
          throw new Error('apply failed: error creating container: image not found')
        },
      )

      await expect(
        executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() }),
      ).rejects.toThrow('Failed to apply workspaces: ws1')

      const output = capturedStderr(stderrSpy)
      expect(output).toContain('[ws1] create docker_network.main')
      expect(output).toContain('[ws1] error: docker_container.app - error creating container: image not found')
    })

    it('Terraform diagnostic fixture → diagnostic output', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      const events = [
        parseTerraformStreamLine(TERRAFORM_STREAM_DIAGNOSTIC),
        parseTerraformStreamLine(TERRAFORM_APPLY_START),
        parseTerraformStreamLine(TERRAFORM_APPLY_COMPLETE),
      ].filter((e): e is ProviderEvent => e !== null)

      expect(events).toHaveLength(3)

      mockGetPlan.mockResolvedValue(planWithChanges())
      mockApply.mockImplementation(mockApplyWithEvents(events))

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      const output = capturedStderr(stderrSpy)
      expect(output).toContain('[ws1] warning: Deprecated attribute')
    })

    it('Pulumi error fixture → error output', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      const events = [parsePulumiStreamLine(PULUMI_RESOURCE_PRE), parsePulumiStreamLine(PULUMI_RES_OP_FAILED)].filter(
        (e): e is ProviderEvent => e !== null,
      )

      expect(events).toHaveLength(2)

      mockGetPlan.mockResolvedValue(planWithChanges())
      mockApply.mockImplementation(
        async (_input: ProviderInput, options?: { onEvent?: (event: ProviderEvent) => void }) => {
          for (const event of events) options?.onEvent?.(event)
          throw new Error('apply failed: error creating container: image not found')
        },
      )

      await expect(
        executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() }),
      ).rejects.toThrow('Failed to apply workspaces: ws1')

      const output = capturedStderr(stderrSpy)
      expect(output).toContain('[ws1] error:')
      expect(output).toContain('error creating container: image not found')
    })

    it('Pulumi diagnostic fixture → diagnostic output', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      const events = [
        parsePulumiStreamLine(PULUMI_STREAM_DIAGNOSTIC),
        parsePulumiStreamLine(PULUMI_RESOURCE_PRE),
        parsePulumiStreamLine(PULUMI_RES_OUTPUTS),
      ].filter((e): e is ProviderEvent => e !== null)

      expect(events).toHaveLength(3)

      mockGetPlan.mockResolvedValue(planWithChanges())
      mockApply.mockImplementation(mockApplyWithEvents(events))

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      const output = capturedStderr(stderrSpy)
      expect(output).toContain('[ws1] warning: Deprecated resource type')
    })

    it('Terraform progress fixture is skipped in non-TTY', async () => {
      envSelected()
      const ws1 = createWs('ws1')
      const monorepo = new Monorepo('/root', [ws1], [], undefined)
      const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
      const executor = new MultistageExecutor(ctx)

      const events = [
        parseTerraformStreamLine(TERRAFORM_APPLY_START),
        parseTerraformStreamLine(TERRAFORM_APPLY_PROGRESS),
        parseTerraformStreamLine(TERRAFORM_APPLY_COMPLETE),
      ].filter((e): e is ProviderEvent => e !== null)

      expect(events).toHaveLength(3)

      mockGetPlan.mockResolvedValue(planWithChanges())
      mockApply.mockImplementation(mockApplyWithEvents(events))

      await executor.exec({ formatter: createFormatter(), integration: createInteractiveIntegration() })

      const output = capturedStderr(stderrSpy)
      // Start and complete present
      expect(output).toContain('[ws1] create docker_network.main\n')
      expect(output).toContain('[ws1] create docker_network.main (12s)')
      // Progress line should NOT appear in non-TTY output
      const lines = output.split('\n').filter((l) => l.includes('[ws1]'))
      expect(lines).toHaveLength(2)
    })
  })
})
