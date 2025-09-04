import type { IProvider } from './provider.js'
import { pulumiProvider } from './pulumi-provider.js'
import { terraformProvider } from './terraform-provider.js'

export * from './pulumi-provider.js'
export * from './terraform-provider.js'
export * from './provider.js'
export * from './provider-plan.js'

export const providers = [pulumiProvider, terraformProvider]

export function getProvider(provider: string): IProvider | undefined {
  return providers.find((p) => p.getProviderName() === provider)
}
