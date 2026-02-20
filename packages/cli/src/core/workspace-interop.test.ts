import { vi } from 'vitest'
import { WorkspaceInterop } from './workspace-interop.js'
import { Monorepo, Workspace } from './model.js'
import { MockProvider } from '../__test-utils__/mock-provider.js'
import { StateManager, State } from './state-manager.js'
import type { ProviderPlan } from '../providers/provider-plan.js'

// Mock the state manager to avoid filesystem
vi.mock('./state-manager.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./state-manager.js')>()
  return {
    ...original,
    StateManager: vi.fn().mockImplementation(() => ({
      read: vi.fn().mockResolvedValue(new original.State()),
      update: vi.fn().mockImplementation(async (fn: (s: InstanceType<typeof original.State>) => void) => {
        fn(new original.State())
      }),
    })),
  }
})

function setup(opts?: { cachedOutputs?: Record<string, string> }) {
  const provider = new MockProvider()
  const ws = new Workspace('ws1', '/path/to/ws1', '/path/to/monorepo', provider, {}, [], { dev: {} })
  const monorepo = new Monorepo('/path/to/monorepo', [ws], [], undefined)

  if (opts?.cachedOutputs) {
    const mockStateManager = vi.mocked(StateManager)
    mockStateManager.mockImplementation(
      () =>
        ({
          read: vi.fn().mockImplementation(async () => {
            const state = new State()
            state.restore({
              current_environment: 'dev',
              workspaces: { ws1: { env: 'dev', outputs: opts.cachedOutputs } },
            })
            return state
          }),
          update: vi.fn().mockImplementation(async (fn: (s: State) => void) => {
            fn(new State())
          }),
        }) as unknown as StateManager,
    )
  }

  const interop = new WorkspaceInterop(monorepo, ws, 'dev')
  return { provider, ws, monorepo, interop }
}

describe('WorkspaceInterop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should throw when workspace missing requested env', () => {
    const provider = new MockProvider()
    const ws = new Workspace('ws1', '/path/to/ws1', '/path/to/monorepo', provider, {}, [], { dev: {} })
    const monorepo = new Monorepo('/path/to/monorepo', [ws], [], undefined)

    expect(() => new WorkspaceInterop(monorepo, ws, 'prod')).toThrow("Workspace ws1 doesn't contain environment prod")
  })

  it('should delegate getPlan to provider', async () => {
    const { provider, interop } = setup()
    const mockPlan: ProviderPlan = {
      provider: 'mock',
      projectName: 'ws1',
      timestamp: new Date(),
      resourceChanges: [],
      outputs: [],
      diagnostics: [],
      changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 },
      metadata: {},
    }
    provider.getPlan.mockResolvedValue(mockPlan)

    const result = await interop.getPlan({ key: 'value' })
    expect(result).toBe(mockPlan)
    expect(provider.getPlan).toHaveBeenCalledWith(
      expect.objectContaining({ alias: 'ws1', rootPath: '/path/to/ws1' }),
      { key: 'value' },
      'dev',
    )
  })

  it('should delegate apply to provider and return outputs', async () => {
    const { provider, interop } = setup()
    provider.apply.mockResolvedValue({ url: 'http://localhost' })

    const result = await interop.apply({ input: 'val' })
    expect(result).toEqual({ url: 'http://localhost' })
    expect(provider.apply).toHaveBeenCalledOnce()
  })

  it('should delegate destroyPlan to provider', async () => {
    const { provider, interop } = setup()
    const mockPlan: ProviderPlan = {
      provider: 'mock',
      projectName: 'ws1',
      timestamp: new Date(),
      resourceChanges: [],
      outputs: [],
      diagnostics: [],
      changeSummary: { add: 0, change: 0, remove: 1, replace: 0, outputUpdates: 0 },
      metadata: {},
    }
    provider.destroyPlan.mockResolvedValue(mockPlan)

    const result = await interop.destroyPlan({})
    expect(result).toBe(mockPlan)
  })

  it('should delegate destroy to provider', async () => {
    const { provider, interop } = setup()
    provider.destroy.mockResolvedValue(undefined)

    await interop.destroy({})
    expect(provider.destroy).toHaveBeenCalledOnce()
  })

  it('should delegate isDestroyed to provider', async () => {
    const { provider, interop } = setup()
    provider.isDestroyed.mockResolvedValue(true)

    const result = await interop.isDestroyed()
    expect(result).toBe(true)
  })

  it('should delegate selectEnvironment to provider', async () => {
    const { provider, interop } = setup()
    provider.selectEnvironment.mockResolvedValue(undefined)

    await interop.selectEnvironment()
    expect(provider.selectEnvironment).toHaveBeenCalledOnce()
  })

  it('should fetch live outputs when stale not requested', async () => {
    const { provider, interop } = setup()
    provider.getOutputs.mockResolvedValue({ key: 'live-value' })

    const { outputs, actual } = await interop.getOutputs()
    expect(outputs).toEqual({ key: 'live-value' })
    expect(actual).toBe(true)
    expect(provider.getOutputs).toHaveBeenCalledOnce()
  })

  it('should return cached outputs when stale requested and cached exists', async () => {
    const { provider, interop } = setup({ cachedOutputs: { key: 'cached-value' } })

    const { outputs, actual } = await interop.getOutputs({ stale: true })
    expect(outputs).toEqual({ key: 'cached-value' })
    expect(actual).toBe(false)
    expect(provider.getOutputs).not.toHaveBeenCalled()
  })

  it('should delegate getDriftPlan to provider', async () => {
    const { provider, interop } = setup()
    const mockPlan: ProviderPlan = {
      provider: 'mock',
      projectName: 'ws1',
      timestamp: new Date(),
      resourceChanges: [],
      outputs: [],
      diagnostics: [],
      changeSummary: { add: 0, change: 1, remove: 0, replace: 0, outputUpdates: 0 },
      metadata: {},
    }
    provider.getDriftPlan.mockResolvedValue(mockPlan)

    const result = await interop.getDriftPlan({ key: 'value' })
    expect(result).toBe(mockPlan)
    expect(provider.getDriftPlan).toHaveBeenCalledWith(
      expect.objectContaining({ alias: 'ws1', rootPath: '/path/to/ws1' }),
      { key: 'value' },
      'dev',
    )
  })

  it('should delegate refresh to provider', async () => {
    const { provider, interop } = setup()
    provider.refresh.mockResolvedValue(undefined)

    await interop.refresh({ key: 'value' })
    expect(provider.refresh).toHaveBeenCalledWith(expect.objectContaining({ alias: 'ws1' }), { key: 'value' }, 'dev')
  })

  it('should delegate importResource to provider', async () => {
    const { provider, interop } = setup()
    provider.importResource.mockResolvedValue('Import successful')

    const result = await interop.importResource(['aws_instance.web', 'i-123'], { key: 'value' })
    expect(result).toBe('Import successful')
    expect(provider.importResource).toHaveBeenCalledWith(
      expect.objectContaining({ alias: 'ws1' }),
      ['aws_instance.web', 'i-123'],
      { key: 'value' },
      'dev',
    )
  })

  it('should delegate generateCode to provider', async () => {
    const { provider, interop } = setup()
    provider.generateCode.mockResolvedValue('resource "aws_instance" "web" {}')

    const result = await interop.generateCode(['aws_instance.web', 'i-123'], { key: 'value' })
    expect(result).toBe('resource "aws_instance" "web" {}')
    expect(provider.generateCode).toHaveBeenCalledWith(
      expect.objectContaining({ alias: 'ws1' }),
      ['aws_instance.web', 'i-123'],
      { key: 'value' },
      'dev',
    )
  })

  it('should build correct provider config', async () => {
    const { provider, interop } = setup()
    provider.getPlan.mockResolvedValue({
      provider: 'mock',
      projectName: 'ws1',
      timestamp: new Date(),
      resourceChanges: [],
      outputs: [],
      diagnostics: [],
      changeSummary: { add: 0, change: 0, remove: 0, replace: 0, outputUpdates: 0 },
      metadata: {},
    })

    await interop.getPlan({})
    expect(provider.getPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        rootMonoRepoFolder: '/path/to/monorepo',
        rootPath: '/path/to/ws1',
        provider: 'mock',
        alias: 'ws1',
        envs: { dev: {} },
      }),
      {},
      'dev',
    )
  })
})
