import type { IFormatter } from './formatter.js'
import type { ProviderPlan } from '../providers/index.js'

export const CLITableFormatter: IFormatter = {
  format(plan: ProviderPlan): string {
    return `TODO ${plan.projectName}`
  },
}
