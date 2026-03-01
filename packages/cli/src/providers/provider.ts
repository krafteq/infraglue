import type { ProviderPlan } from './provider-plan.js'
import type { ProviderEvent } from './provider-events.js'

export interface OutputValue {
  value: string
  secret: boolean
}

export type ProviderOutput = Record<string, OutputValue>
export type ProviderInput = Record<string, OutputValue>

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
  rootVars?: Record<string, string>
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
    options?: { detailed?: boolean; refresh?: boolean; savePlanFile?: boolean },
  ): Promise<ProviderPlan>
  apply(
    configuration: ProviderConfig,
    input: ProviderInput,
    env: string,
    options?: { onEvent?: (event: ProviderEvent) => void; planFile?: string },
  ): Promise<ProviderOutput>
  getOutputs(configuration: ProviderConfig, env: string): Promise<ProviderOutput>

  destroyPlan(
    configuration: ProviderConfig,
    input: ProviderInput,
    env: string,
    options?: { savePlanFile?: boolean },
  ): Promise<ProviderPlan>
  destroy(
    configuration: ProviderConfig,
    input: ProviderInput,
    env: string,
    options?: { onEvent?: (event: ProviderEvent) => void; planFile?: string },
  ): Promise<void>
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
