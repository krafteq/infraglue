import type { ProviderPlan } from '../providers/index.js'

export interface IFormatter {
  format(plan: ProviderPlan): string
}
