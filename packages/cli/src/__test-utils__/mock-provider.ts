import { vi } from 'vitest'
import { Monorepo, Workspace } from '../core/model.js'
import type { EnvironmentConfig, IProvider, ProviderOutput, ProviderPlan } from '../providers/index.js'
import type { ChangeSummary } from '../providers/provider-plan.js'

export class MockProvider implements IProvider {
  getProviderName = vi.fn(() => 'mock')
  getPlan = vi.fn<IProvider['getPlan']>((): Promise<ProviderPlan> => {
    throw new Error('Method not implemented.')
  })
  apply = vi.fn<IProvider['apply']>((): Promise<ProviderOutput> => {
    throw new Error('Method not implemented.')
  })
  getOutputs = vi.fn<IProvider['getOutputs']>((): Promise<ProviderOutput> => {
    throw new Error('Method not implemented.')
  })
  destroyPlan = vi.fn<IProvider['destroyPlan']>((): Promise<ProviderPlan> => {
    throw new Error('Method not implemented.')
  })
  destroy = vi.fn<IProvider['destroy']>((): Promise<void> => {
    throw new Error('Method not implemented.')
  })
  isDestroyed = vi.fn<IProvider['isDestroyed']>((): Promise<boolean> => {
    throw new Error('Method not implemented.')
  })
  selectEnvironment = vi.fn<IProvider['selectEnvironment']>((): Promise<void> => Promise.resolve())
  existsInFolder = vi.fn<IProvider['existsInFolder']>((): Promise<boolean> => {
    throw new Error('Method not implemented.')
  })
  execAnyCommand = vi.fn<IProvider['execAnyCommand']>((): Promise<void> => {
    throw new Error('Method not implemented.')
  })
}

export function createWorkspace(
  name: string,
  dependsOn: string[] = [],
  injections: Record<string, { workspace: string; key: string }> = {},
  envs: string[] = ['dev'],
  provider?: IProvider,
): Workspace {
  const envConfig: Record<string, EnvironmentConfig> = envs.reduce(
    (acc, env) => ({ ...acc, [env]: {} }),
    {} as Record<string, EnvironmentConfig>,
  )
  return new Workspace(
    name,
    `/path/to/${name}`,
    '/path/to/monorepo',
    provider ?? new MockProvider(),
    injections,
    dependsOn,
    envConfig,
  )
}

export function createMonorepo(
  workspaces: Workspace[],
  exports: { name: string; workspace: string; key: string }[] = [],
  config?: ConstructorParameters<typeof Monorepo>[3],
): Monorepo {
  return new Monorepo('/path/to/monorepo', workspaces, exports, config)
}

export function createProviderPlan(overrides: Partial<ProviderPlan> = {}): ProviderPlan {
  return {
    provider: 'mock',
    projectName: 'test-project',
    timestamp: new Date('2025-01-01'),
    resourceChanges: [],
    outputs: [],
    diagnostics: [],
    changeSummary: zeroCounts(),
    metadata: {},
    ...overrides,
  }
}

function zeroCounts(): ChangeSummary {
  return { add: 0, change: 0, remove: 0, replace: 0, outputUpdates: 0 }
}
