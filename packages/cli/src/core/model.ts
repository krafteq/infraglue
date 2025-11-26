// global monorepo context, no workspace is selected
import type { EnvironmentConfig, IProvider } from '../providers'
import { sortGraphNodesByLevels } from '../utils'
import type { MonorepoConfig } from './config-files'
import { WorkspaceInterop } from './workspace-interop'

export class ExecutionContext {
  public readonly workspaceOutputs: AppliedWorkspace[] = []
  public constructor(
    public readonly monorepo: Monorepo,
    public readonly currentWorkspace: Workspace | undefined,
    public readonly ignoreDependencies: boolean,
    public readonly isDestroy: boolean,
    public readonly env: string,
  ) {}

  public interop(workspace: Workspace): WorkspaceInterop {
    return new WorkspaceInterop(this.monorepo, workspace, this.env)
  }

  public findAppliedOutput(wsKey: string, output: string): string | undefined {
    const ws = this.monorepo.getWorkspace(wsKey)
    const appliedWs = this.workspaceOutputs.find((x) => x.name === ws.name)
    if (!appliedWs) {
      return undefined
    }
    return appliedWs.outputValues[output]
  }

  public async getInputs(workspace: Workspace): Promise<Record<string, string>> {
    const inputs: Record<string, string> = {}

    for (const injectionKey in workspace.injections) {
      const injection = workspace.injections[injectionKey]
      if (injection.workspace === undefined) {
        throw new Error(`Value to inject ${injectionKey} cannot be resolved: no workspace set`)
      }

      const ws = this.monorepo.getWorkspace(injection.workspace)

      const appliedWs = this.workspaceOutputs.find((x) => x.name === ws.name)
      if (appliedWs) {
        const val = appliedWs.outputValues[injection.key]
        if (val === undefined) {
          throw new Error(`Value to inject ${injection.key} from workspace ${ws.name} is not found`)
        }
        inputs[injectionKey] = val
        continue
      }

      const { outputs, actual } = await this.interop(ws).getOutputs({ stale: this.ignoreDependencies })
      if (actual) {
        this.storeWorkspaceOutputs(ws, outputs)
      }
      const val = outputs[injection.key]
      if (val === undefined) {
        throw new Error(`Value to inject ${injection.key} from workspace ${ws.name} is not found`)
      }
      inputs[injectionKey] = val
    }

    return inputs
  }

  public storeWorkspaceOutputs(workspace: Workspace, outputs: Record<string, string>) {
    const existingIdx = this.workspaceOutputs.findIndex((x) => x.name === workspace.name)
    if (existingIdx >= 0) {
      this.workspaceOutputs.splice(existingIdx, 1)
    }
    this.workspaceOutputs.push(new AppliedWorkspace(workspace.name, outputs))
  }

  public storeDestroyedWorkspace(workspace: Workspace) {
    const existingIdx = this.workspaceOutputs.findIndex((x) => x.name === workspace.name)
    if (existingIdx >= 0) {
      this.workspaceOutputs.splice(existingIdx, 1)
    }
  }
}

export class Monorepo {
  public constructor(
    public readonly path: string,
    public readonly workspaces: Workspace[],
    public readonly exports: { name: string; workspace: string; key: string }[],
    public readonly configFile: MonorepoConfig | undefined,
  ) {}

  public getDependencies(ws: Workspace): Workspace[] {
    return ws.allDependsOn.map((x) => this.getWorkspace(x))
  }

  public getDependants(ws: Workspace): Workspace[] {
    return this.workspaces.filter((x) => x.allDependsOn.filter((key) => ws.matchKey(key)).length > 0)
  }

  public getTransitiveDependencies(ws: Workspace): Workspace[] {
    const visited = new Set<string>()
    const dependencies: Workspace[] = []

    const traverse = (currentWs: Workspace) => {
      const directDeps = this.getDependencies(currentWs)
      for (const dep of directDeps) {
        if (!visited.has(dep.name)) {
          visited.add(dep.name)
          dependencies.push(dep)
          traverse(dep)
        }
      }
    }

    traverse(ws)
    return dependencies
  }

  public getWorkspace(key: string) {
    const ws = this.findWorkspace(key)
    if (ws === null) {
      throw new Error(`Workspace not found: ${key}`)
    }
    return ws
  }

  public findWorkspace(key: string): Workspace | null {
    const ws = this.workspaces.find((x) => x.matchKey(key))
    return ws ?? null
  }
}

export class Workspace {
  public readonly allDependsOn: string[]

  public constructor(
    public readonly name: string,
    public readonly path: string,
    public readonly monorepoPath: string,
    public readonly provider: IProvider,
    public readonly injections: Record<string, { workspace: string; key: string }>,
    public readonly dependsOn: string[],
    public readonly envs: Record<string, EnvironmentConfig>,
  ) {
    this.allDependsOn = [
      ...new Set(
        Object.values(this.injections)
          .map((x) => x.workspace)
          .concat(this.dependsOn),
      ),
    ]
  }

  public matchKey(key: string): boolean {
    return this.name === key || this.path === key
  }

  public get providerName(): string {
    return this.provider.getProviderName()
  }

  public hasEnv(env: string): boolean {
    return this.envs[env] !== undefined
  }
}

export class ExecutionPlan {
  public constructor(public readonly levels: ExecutionLevel[]) {}

  public get levelsCount() {
    return this.levels.length
  }
}

export class ExecutionLevel {
  public constructor(public readonly workspaces: Workspace[]) {}
}

export class AppliedWorkspace {
  public constructor(
    public readonly name: string,
    public readonly outputValues: Record<string, string>,
  ) {}
}

export class ExecutionPlanBuilder {
  private readonly workspaces: Workspace[]

  public constructor(private readonly ctx: ExecutionContext) {
    this.workspaces = this.filterWorkspaces()
  }

  public build(): ExecutionPlan {
    const levels = sortGraphNodesByLevels(this.workspaces, (w) => this.getWorkspacesToBeExecutedBefore(w))
    return new ExecutionPlan(levels.map((workspaces) => new ExecutionLevel(workspaces)))
  }

  private getWorkspacesToBeExecutedBefore(workspace: Workspace): Workspace[] {
    if (this.ctx.ignoreDependencies) {
      return []
    }

    const candidates = this.ctx.isDestroy
      ? this.ctx.monorepo.getDependants(workspace)
      : this.ctx.monorepo.getDependencies(workspace)

    for (const candidate of candidates) {
      if (!candidate.hasEnv(this.ctx.env)) {
        throw new Error(
          `Workspace ${workspace.name} has unresolved dependency ${candidate.name} in environment ${this.ctx.env}`,
        )
      }
    }

    return candidates
  }

  private filterWorkspaces() {
    let candidates = this.ctx.monorepo.workspaces
    if (this.ctx.currentWorkspace) {
      candidates = [this.ctx.currentWorkspace]
      if (!this.ctx.ignoreDependencies) {
        candidates.push(...this.ctx.monorepo.getTransitiveDependencies(this.ctx.currentWorkspace))
      }
    }
    return candidates.filter((x) => x.hasEnv(this.ctx.env))
  }
}
