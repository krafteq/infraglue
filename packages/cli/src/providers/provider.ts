import type { ProviderConfig } from '../core/platform-detector.js'
import type { ProviderPlan } from './provider-plan.js'

export type ProviderOutput = Record<string, string> // TODO: for pulumi it could be a complex object. MB we need to allow deeper value selection in the future.
export type ProviderInput = Record<string, string>

export interface IProvider {
  getProviderName(): string
  getPlan(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<ProviderPlan>
  apply(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<ProviderOutput>
  getOutputs(configuration: ProviderConfig, env: string): Promise<ProviderOutput>
  // TODO: apply plan only

  destroyPlan(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<ProviderPlan>
  destroy(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<void>
  isDestroyed(configuration: ProviderConfig, env: string): Promise<boolean>

  selectEnvironment(configuration: ProviderConfig, env: string): Promise<void>

  existsInFolder(folderPath: string): Promise<boolean>

  execAnyCommand(command: string, configuration: ProviderConfig, input: ProviderInput, env: string): Promise<string>
}
