import { type Monorepo, Workspace } from './model.js'
import type { IProvider, ProviderConfig, ProviderInput, ProviderOutput, ProviderPlan } from '../providers/index.js'
import { StateManager } from './state-manager.js'
import { logger } from '../utils/index.js'

/*
  Calls provider commands on Workspace
  Uses State to optimize outputs handling
 */
export class WorkspaceInterop {
  private readonly stateManager: StateManager
  private readonly provider: IProvider

  public constructor(
    private readonly monorepo: Monorepo,
    private readonly workspace: Workspace,
    private readonly env: string,
  ) {
    this.stateManager = new StateManager(this.monorepo.path)
    this.provider = workspace.provider
    if (!this.workspace.hasEnv(this.env)) {
      throw new Error(`Workspace ${this.workspace.name} doesn't contain environment ${this.env}`)
    }
  }

  public async getOutputs(opts?: { stale?: boolean }): Promise<{ outputs: ProviderOutput; actual: boolean }> {
    if (opts?.stale) {
      const state = await this.stateManager.read()
      const cachedOutputs = state.workspace(this.workspace.name).outputs
      if (cachedOutputs) {
        logger.info(`Getting stale outputs for workspace ${this.workspace.name}`)
        return { outputs: cachedOutputs, actual: false }
      }
    }

    const outputs = await this.provider.getOutputs(this.providerConfig(), this.env)
    await this.storeOutputs(outputs)
    return { outputs, actual: true }
  }

  public getPlan(input: ProviderInput): Promise<ProviderPlan> {
    return this.provider.getPlan(this.providerConfig(), input, this.env)
  }

  public async apply(input: ProviderInput): Promise<ProviderOutput> {
    const outputs = await this.provider.apply(this.providerConfig(), input, this.env)
    await this.storeOutputs(outputs)
    return outputs
  }

  public destroyPlan(input: ProviderInput): Promise<ProviderPlan> {
    return this.provider.destroyPlan(this.providerConfig(), input, this.env)
  }

  public destroy(input: ProviderInput): Promise<void> {
    return this.provider.destroy(this.providerConfig(), input, this.env)
  }

  public isDestroyed(): Promise<boolean> {
    return this.provider.isDestroyed(this.providerConfig(), this.env)
  }

  public async selectEnvironment(): Promise<void> {
    await this.storeOutputs(null)
    logger.info(`Selecting environment for ${this.workspace.name}`)
    await this.provider.selectEnvironment(this.providerConfig(), this.env)
    logger.info(`Selected environment for ${this.workspace.name}`)
  }

  public existsInFolder(folderPath: string): Promise<boolean> {
    return this.provider.existsInFolder(folderPath)
  }

  public execAnyCommand(command: string[], input: () => Promise<ProviderInput>): Promise<void> {
    return this.provider.execAnyCommand(command, this.providerConfig(), input, this.env)
  }

  private async storeOutputs(outputs: ProviderOutput | null): Promise<void> {
    // todo: ignore by configuration
    await this.stateManager.update((s) => {
      s.workspace(this.workspace.name).outputs = outputs == null ? undefined : outputs
    })
  }

  private providerConfig(): ProviderConfig {
    return {
      rootMonoRepoFolder: this.workspace.monorepoPath,
      envs: this.workspace.envs,
      alias: this.workspace.name,
      rootPath: this.workspace.path,
      provider: this.workspace.providerName,
      depends_on: this.workspace.allDependsOn,
      injections: this.workspace.injections,
    }
  }
}
