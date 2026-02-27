import { AppliedWorkspace, ExecutionContext, ExecutionPlanBuilder, Monorepo } from './model.js'
import { createMonorepo, createWorkspace } from '../__test-utils__/mock-provider.js'

describe('Workspace', () => {
  it('should calculate allDependsOn correctly', () => {
    const ws = createWorkspace('ws1', ['dep1'], {
      inj1: { workspace: 'dep2', key: 'output1' },
    })
    expect(ws.allDependsOn).toContain('dep1')
    expect(ws.allDependsOn).toContain('dep2')
    expect(ws.allDependsOn).toHaveLength(2)
  })

  it('should match key by name or path', () => {
    const ws = createWorkspace('ws1')
    expect(ws.matchKey('ws1')).toBe(true)
    expect(ws.matchKey('/path/to/ws1')).toBe(true)
    expect(ws.matchKey('other')).toBe(false)
  })

  it('should check if environment exists', () => {
    const ws = createWorkspace('ws1', [], {}, ['dev', 'prod'])
    expect(ws.hasEnv('dev')).toBe(true)
    expect(ws.hasEnv('prod')).toBe(true)
    expect(ws.hasEnv('staging')).toBe(false)
  })

  it('should default rootVars to empty object', () => {
    const ws = createWorkspace('ws1')
    expect(ws.rootVars).toEqual({})
  })

  it('should store rootVars when provided', () => {
    const ws = createWorkspace('ws1', [], {}, ['dev'], undefined, { region: 'us-east-1' })
    expect(ws.rootVars).toEqual({ region: 'us-east-1' })
  })
})

describe('Monorepo', () => {
  const ws1 = createWorkspace('ws1')
  const ws2 = createWorkspace('ws2', ['ws1'])
  const ws3 = createWorkspace('ws3', ['ws2'])
  const workspaces = [ws1, ws2, ws3]
  const monorepo = new Monorepo('/root', workspaces, [], undefined)

  it('should find workspace by key', () => {
    expect(monorepo.findWorkspace('ws1')).toBe(ws1)
    expect(monorepo.findWorkspace('non-existent')).toBeNull()
  })

  it('should get workspace or throw', () => {
    expect(monorepo.getWorkspace('ws1')).toBe(ws1)
    expect(() => monorepo.getWorkspace('non-existent')).toThrow("Workspace 'non-existent' not found")
  })

  it('should get dependencies', () => {
    const deps = monorepo.getDependencies(ws2)
    expect(deps).toEqual([ws1])
  })

  it('should get dependants', () => {
    const dependants = monorepo.getDependants(ws1)
    expect(dependants).toEqual([ws2])
  })

  it('should get transitive dependencies', () => {
    // ws3 -> ws2 -> ws1
    const deps = monorepo.getTransitiveDependencies(ws3)
    expect(deps).toHaveLength(2)
    expect(deps).toContain(ws2)
    expect(deps).toContain(ws1)
  })

  it('should handle diamond dependencies', () => {
    const A = createWorkspace('A')
    const B = createWorkspace('B', ['A'])
    const C = createWorkspace('C', ['A'])
    const D = createWorkspace('D', ['B', 'C'])
    const diamondRepo = new Monorepo('/root', [A, B, C, D], [], undefined)

    const deps = diamondRepo.getTransitiveDependencies(D)
    expect(deps).toHaveLength(3)
    expect(deps).toContain(A)
    expect(deps).toContain(B)
    expect(deps).toContain(C)
  })

  it('should handle no dependencies', () => {
    const deps = monorepo.getTransitiveDependencies(ws1)
    expect(deps).toEqual([])
  })

  it('should get transitive dependants', () => {
    // ws1 -> ws2 -> ws3, so dependants of ws1 are [ws2, ws3]
    const dependants = monorepo.getTransitiveDependants(ws1)
    expect(dependants).toHaveLength(2)
    expect(dependants).toContain(ws2)
    expect(dependants).toContain(ws3)
  })

  it('should get transitive dependants for middle node', () => {
    // dependants of ws2 are [ws3]
    const dependants = monorepo.getTransitiveDependants(ws2)
    expect(dependants).toHaveLength(1)
    expect(dependants).toContain(ws3)
  })

  it('should return empty transitive dependants for leaf node', () => {
    const dependants = monorepo.getTransitiveDependants(ws3)
    expect(dependants).toEqual([])
  })

  it('should handle diamond dependants', () => {
    const A = createWorkspace('A')
    const B = createWorkspace('B', ['A'])
    const C = createWorkspace('C', ['A'])
    const D = createWorkspace('D', ['B', 'C'])
    const diamondRepo = new Monorepo('/root', [A, B, C, D], [], undefined)

    const dependants = diamondRepo.getTransitiveDependants(A)
    expect(dependants).toHaveLength(3)
    expect(dependants).toContain(B)
    expect(dependants).toContain(C)
    expect(dependants).toContain(D)
  })

  it('should default vars to empty object', () => {
    expect(monorepo.vars).toEqual({})
  })

  it('should store vars when provided', () => {
    const repo = createMonorepo(workspaces, [], undefined, { region: 'us-east-1' })
    expect(repo.vars).toEqual({ region: 'us-east-1' })
  })
})

describe('ExecutionContext', () => {
  const ws1 = createWorkspace('ws1')
  const ws2 = createWorkspace('ws2')
  const appliedWs1 = new AppliedWorkspace('ws1', { out1: { value: 'val1', secret: false } })
  const monorepo = new Monorepo('/root', [ws1, ws2], [], undefined)
  const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
  ctx.storeWorkspaceOutputs(ws1, appliedWs1.outputValues)

  it('should find output from applied workspace', () => {
    expect(ctx.findAppliedOutput('ws1', 'out1')).toEqual({ value: 'val1', secret: false })
    expect(ctx.findAppliedOutput('ws1', 'out2')).toBeUndefined()
    expect(ctx.findAppliedOutput('ws2', 'out1')).toBeUndefined()
  })

  it('should get inputs resolving injections', async () => {
    const ws2WithInj = createWorkspace('ws2WithInj', [], {
      input1: { workspace: 'ws1', key: 'out1' },
    })
    const inputs = await ctx.getInputs(ws2WithInj)
    expect(inputs).toEqual({ input1: { value: 'val1', secret: false } })
  })

  it('should throw error if injection value not found', async () => {
    const ws2WithMissingInj = createWorkspace('ws2WithMissingInj', [], {
      input1: { workspace: 'ws1', key: 'missing' },
    })
    await expect(ctx.getInputs(ws2WithMissingInj)).rejects.toThrow(
      'Value to inject missing from workspace ws1 is not found',
    )
  })

  it('should use placeholder inputs when bestEffort is true and injection value not found', async () => {
    const ws2WithMissingInj = createWorkspace('ws2WithMissingInj', [], {
      input1: { workspace: 'ws1', key: 'missing' },
    })
    const inputs = await ctx.getInputs(ws2WithMissingInj, { bestEffort: true })
    expect(inputs).toEqual({ input1: { value: '', secret: false } })
  })

  it('should store applied workspace', () => {
    ctx.storeWorkspaceOutputs(ws2, { out2: { value: 'val2', secret: false } })
    expect(ctx.workspaceOutputs).toHaveLength(2)
    expect(ctx.findAppliedOutput('ws2', 'out2')).toEqual({ value: 'val2', secret: false })

    // Update existing
    ctx.storeWorkspaceOutputs(ws2, { out2: { value: 'new-val2', secret: false } })
    expect(ctx.workspaceOutputs).toHaveLength(2)
    expect(ctx.findAppliedOutput('ws2', 'out2')).toEqual({ value: 'new-val2', secret: false })
  })

  it('should remove destroyed workspace', () => {
    ctx.storeDestroyedWorkspace(ws1)
    expect(ctx.workspaceOutputs.find((w) => w.name === 'ws1')).toBeUndefined()
  })
})

describe('ExecutionPlanBuilder', () => {
  const ws1 = createWorkspace('ws1')
  const ws2 = createWorkspace('ws2', ['ws1'])
  const ws3 = createWorkspace('ws3', ['ws2'])
  const workspaces = [ws1, ws2, ws3]
  const monorepo = new Monorepo('/root', workspaces, [], undefined)

  it('should build execution plan with correct levels', () => {
    const ctx = new ExecutionContext(monorepo, undefined, false, false, 'dev')
    const builder = new ExecutionPlanBuilder(ctx)
    const plan = builder.build()

    expect(plan.levelsCount).toBe(3)
    expect(plan.levels[0].workspaces).toEqual([ws1])
    expect(plan.levels[1].workspaces).toEqual([ws2])
    expect(plan.levels[2].workspaces).toEqual([ws3])
  })

  it('should respect ignoreDependencies flag', () => {
    const ctx = new ExecutionContext(monorepo, undefined, true, false, 'dev')
    const builder = new ExecutionPlanBuilder(ctx)
    const plan = builder.build()

    // When dependencies are ignored, all workspaces can be in the first level (or implementation detail of sort)
    // But importantly, they shouldn't be blocked by dependencies.
    // The current implementation of sortGraphNodesByLevels puts nodes with no deps (or ignored deps) in first level.
    expect(plan.levelsCount).toBe(1)
    expect(plan.levels[0].workspaces).toHaveLength(3)
    expect(plan.levels[0].workspaces).toContain(ws1)
    expect(plan.levels[0].workspaces).toContain(ws2)
    expect(plan.levels[0].workspaces).toContain(ws3)
  })

  it('should reverse dependencies for destroy', () => {
    const ctx = new ExecutionContext(monorepo, undefined, false, true, 'dev')
    const builder = new ExecutionPlanBuilder(ctx)
    const plan = builder.build()

    // Destroy order should be reverse of apply order: ws3 -> ws2 -> ws1
    expect(plan.levelsCount).toBe(3)
    expect(plan.levels[0].workspaces).toEqual([ws3])
    expect(plan.levels[1].workspaces).toEqual([ws2])
    expect(plan.levels[2].workspaces).toEqual([ws1])
  })

  it('should filter workspaces by environment', () => {
    const wsDevOnly = createWorkspace('wsDev', [], {}, ['dev'])
    const wsProdOnly = createWorkspace('wsProd', [], {}, ['prod'])
    const mixedRepo = new Monorepo('/root', [wsDevOnly, wsProdOnly], [], undefined)

    const ctx = new ExecutionContext(mixedRepo, undefined, false, false, 'dev')
    const builder = new ExecutionPlanBuilder(ctx)
    const plan = builder.build()

    expect(plan.levelsCount).toBe(1)
    expect(plan.levels[0].workspaces).toEqual([wsDevOnly])
  })

  it('should include dependants (not dependencies) when --project + destroy', () => {
    // A -> B -> C chain. Destroying B should include C (dependant), not A (dependency)
    const ctx = new ExecutionContext(monorepo, ws2, false, true, 'dev')
    const builder = new ExecutionPlanBuilder(ctx)
    const plan = builder.build()

    const allWorkspaces = plan.levels.flatMap((l) => l.workspaces)
    expect(allWorkspaces).toContain(ws2) // the selected workspace
    expect(allWorkspaces).toContain(ws3) // dependant of ws2
    expect(allWorkspaces).not.toContain(ws1) // dependency of ws2 — should NOT be included
  })

  it('should include dependencies (not dependants) when --project + apply', () => {
    // A -> B -> C chain. Applying B should include A (dependency), not C (dependant)
    const ctx = new ExecutionContext(monorepo, ws2, false, false, 'dev')
    const builder = new ExecutionPlanBuilder(ctx)
    const plan = builder.build()

    const allWorkspaces = plan.levels.flatMap((l) => l.workspaces)
    expect(allWorkspaces).toContain(ws2) // the selected workspace
    expect(allWorkspaces).toContain(ws1) // dependency of ws2
    expect(allWorkspaces).not.toContain(ws3) // dependant of ws2 — should NOT be included
  })

  it('should throw if dependency missing in env', () => {
    const wsA = createWorkspace('A', [], {}, ['dev'])
    const wsB = createWorkspace('B', ['A'], {}, ['prod']) // B depends on A, but A is not in prod (implied by test setup, wait A is in dev)
    // Actually we need to test: B in dev depends on A, but A does not have dev env.

    const wsNoEnv = createWorkspace('NoEnv', [], {}, ['other'])
    const wsWithDep = createWorkspace('WithDep', ['NoEnv'], {}, ['dev'])

    const badRepo = new Monorepo('/root', [wsNoEnv, wsWithDep], [], undefined)
    const ctx = new ExecutionContext(badRepo, undefined, false, false, 'dev')

    // Construction of builder filters workspaces, but build() checks dependencies
    const builder = new ExecutionPlanBuilder(ctx)

    expect(() => builder.build()).toThrow('Workspace WithDep has unresolved dependency NoEnv in environment dev')
  })
})
