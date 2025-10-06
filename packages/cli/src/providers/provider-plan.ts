/**
 * Common ProviderPlan structure for representing infrastructure plans
 * This is provider-agnostic and should not contain any provider-specific logic
 */

/**
 * Represents the type of change that will be applied to a resource
 */
export type ChangeAction = 'create' | 'update' | 'delete' | 'replace' | 'no-op'

/**
 * Represents the status of a resource change
 */
export type ChangeStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'skipped'

/**
 * Represents a single resource change in the plan
 */
export interface ResourceChange {
  readonly address: string
  readonly type: string
  readonly name: string
  readonly actions: ChangeAction[]
  readonly status: ChangeStatus
  readonly before: Record<string, unknown> | null
  readonly after: Record<string, unknown> | null
  readonly metadata: Record<string, unknown>
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

/**
 * Represents a diagnostic message (error, warning, info)
 */
export interface Diagnostic {
  readonly severity: DiagnosticSeverity
  readonly summary: string
  readonly detail: string
  readonly address: string | null
  readonly source: string | null
}

/**
 * Represents the summary of changes
 */
export interface ChangeSummary {
  readonly add: number
  readonly change: number
  readonly remove: number
  readonly replace: number
  readonly outputUpdates: number
}

/**
 * Represents an output value
 */
export interface Output {
  readonly name: string
  readonly value: string
  readonly sensitive: boolean
  readonly description: string | null
  readonly action?: 'added' | 'updated' | 'deleted' | undefined
}

/**
 * Main ProviderPlan interface that represents a unified infrastructure plan
 * This is provider-agnostic and should be populated by individual providers
 */
export interface ProviderPlan {
  readonly provider: string
  readonly projectName: string
  readonly timestamp: Date
  readonly resourceChanges: ResourceChange[]
  readonly workspacesPlan?: Record<string, ProviderPlan>
  readonly outputs: Output[]
  readonly diagnostics: Diagnostic[]
  readonly changeSummary: ChangeSummary
  readonly metadata: Record<string, unknown>
}

export function hasChanges(plan: ProviderPlan) {
  return (
    plan.changeSummary.add > 0 ||
    plan.changeSummary.change > 0 ||
    plan.changeSummary.remove > 0 ||
    plan.changeSummary.replace > 0 ||
    plan.changeSummary.outputUpdates > 0
  )
}
