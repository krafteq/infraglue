import type { PlatformDetectionResult } from './platform-detector'

export type ProviderOutput = Record<string, string>
export type ProviderInput = Record<string, string>

export interface ProviderPlan {
  // TODO: real plan type
  text: string
  // TODO: real type
  output: ProviderOutput
}

export abstract class Provider {
  abstract getProviderName(): string
  abstract getPlan(configuration: PlatformDetectionResult, input: ProviderInput): Promise<ProviderPlan>
  abstract apply(configuration: PlatformDetectionResult, input: ProviderInput): Promise<ProviderOutput>
  // TODO: apply plan only
}
