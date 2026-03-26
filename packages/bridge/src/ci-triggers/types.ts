/**
 * Result of triggering a CI pipeline.
 */
export interface TriggerResult {
  pipelineId: number
  webUrl: string
}

/**
 * Interface for CI pipeline triggers.
 * Each CI system (GitLab CI, TeamCity, etc.) implements this.
 */
export interface CiTrigger {
  trigger(projectId: string, ref: string, variables: Record<string, string>): Promise<TriggerResult>
}
