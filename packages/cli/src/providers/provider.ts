import type { ProviderPlan } from './provider-plan.js'

export type ProviderOutput = Record<string, string> // TODO: for pulumi it could be a complex object. MB we need to allow deeper value selection in the future.
export type ProviderInput = Record<string, string>

export interface PlatformInjection {
  workspace: string | null
  key: string
}

export interface ProviderConfig {
  rootMonoRepoFolder: string
  rootPath: string
  provider: string
  injections: Record<string, PlatformInjection>
  depends_on?: string[]
  envs: Record<string, EnvironmentConfig> | undefined
  alias: string
}

export interface EnvironmentConfig {
  // TODO: MB Environment config should be specific for each provider
  //  It seems like for pulumi we really need only backend_config, or rather Env Vars
  backend_file?: string // for terraform only.
  backend_type?: string // for terraform only.
  backend_config?: Record<string, string>
  var_files?: string[]
  vars?: Record<string, string>
}

export interface IProvider {
  getProviderName(): string
  getPlan(
    configuration: ProviderConfig,
    input: ProviderInput,
    env: string,
    options?: { detailed?: boolean },
  ): Promise<ProviderPlan>
  apply(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<ProviderOutput>
  getOutputs(configuration: ProviderConfig, env: string): Promise<ProviderOutput>
  // TODO: apply plan only

  destroyPlan(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<ProviderPlan>
  destroy(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<void>
  isDestroyed(configuration: ProviderConfig, env: string): Promise<boolean>

  selectEnvironment(configuration: ProviderConfig, env: string): Promise<void>

  existsInFolder(folderPath: string): Promise<boolean>

  getDriftPlan(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<ProviderPlan>
  refresh(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<void>
  importResource(configuration: ProviderConfig, args: string[], input: ProviderInput, env: string): Promise<string>
  generateCode(configuration: ProviderConfig, args: string[], input: ProviderInput, env: string): Promise<string>

  execAnyCommand(
    command: string[],
    configuration: ProviderConfig,
    input: () => Promise<ProviderInput>,
    env: string,
  ): Promise<void>
}
