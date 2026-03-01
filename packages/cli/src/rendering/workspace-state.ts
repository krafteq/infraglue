import type { ChangeSummary } from '../providers/provider-plan.js'
import type { ProviderEvent } from '../providers/provider-events.js'

export type PlanStatus = 'pending' | 'planning' | 'done' | 'up-to-date' | 'failed'

export class WorkspacePlanState {
  public readonly name: string
  public status: PlanStatus = 'pending'
  public readonly startTime: number
  public changeSummary: ChangeSummary | null = null
  public error: string | null = null

  constructor(name: string) {
    this.name = name
    this.startTime = Date.now()
  }

  markPlanning(): void {
    this.status = 'planning'
  }

  markDone(summary: ChangeSummary): void {
    this.status = 'done'
    this.changeSummary = summary
  }

  markUpToDate(): void {
    this.status = 'up-to-date'
  }

  markFailed(error: string): void {
    this.status = 'failed'
    this.error = error
  }

  get elapsedSeconds(): number {
    return Math.round((Date.now() - this.startTime) / 1000)
  }
}

export interface ResourceState {
  address: string
  action: string
  status: 'in-progress' | 'complete' | 'failed'
  elapsedSeconds: number
}

export type WorkspaceStatus = 'in-progress' | 'complete' | 'failed'

export class WorkspaceApplyState {
  public readonly name: string
  public status: WorkspaceStatus = 'in-progress'
  public readonly resources = new Map<string, ResourceState>()
  public completedCount = 0
  public failedCount = 0
  public totalCount = 0
  public addCount = 0
  public changeCount = 0
  public removeCount = 0
  public readonly diagnostics: Array<{ severity: string; summary: string; address: string | null }> = []
  public readonly startTime: number
  public error: string | null = null

  constructor(name: string) {
    this.name = name
    this.startTime = Date.now()
  }

  handleEvent(event: ProviderEvent): void {
    switch (event.type) {
      case 'resource_start':
        this.totalCount++
        this.resources.set(event.address, {
          address: event.address,
          action: event.action,
          status: 'in-progress',
          elapsedSeconds: 0,
        })
        break

      case 'resource_progress': {
        const res = this.resources.get(event.address)
        if (res) {
          res.elapsedSeconds = event.elapsedSeconds
        }
        break
      }

      case 'resource_complete': {
        const res = this.resources.get(event.address)
        if (res) {
          res.status = 'complete'
          res.elapsedSeconds = event.elapsedSeconds
        }
        this.completedCount++
        classifyAction(event.action, this)
        break
      }

      case 'resource_error': {
        const res = this.resources.get(event.address)
        if (res) {
          res.status = 'failed'
        }
        this.failedCount++
        this.diagnostics.push({
          severity: 'error',
          summary: event.message,
          address: event.address,
        })
        break
      }

      case 'diagnostic':
        this.diagnostics.push({
          severity: event.severity,
          summary: event.summary,
          address: event.address,
        })
        break

      case 'summary':
        // Summary is the authoritative source of change counts from the provider
        this.addCount = event.add
        this.changeCount = event.change
        this.removeCount = event.remove
        if (this.totalCount === 0) {
          this.totalCount = event.add + event.change + event.remove
        }
        break
    }
  }

  get changeSummaryText(): string {
    return `+${this.addCount} ~${this.changeCount} -${this.removeCount}`
  }

  markComplete(): void {
    this.status = 'complete'
  }

  markFailed(error: string): void {
    this.status = 'failed'
    this.error = error
  }

  get elapsedSeconds(): number {
    return Math.round((Date.now() - this.startTime) / 1000)
  }

  get currentResource(): ResourceState | undefined {
    for (const res of this.resources.values()) {
      if (res.status === 'in-progress') return res
    }
    return undefined
  }
}

function classifyAction(action: string, state: WorkspaceApplyState): void {
  const a = action.toLowerCase()
  if (a === 'create' || a === 'creating' || a === 'created') {
    state.addCount++
  } else if (a === 'delete' || a === 'deleting' || a === 'deleted' || a === 'destroy') {
    state.removeCount++
  } else if (a === 'update' || a === 'updating' || a === 'updated') {
    state.changeCount++
  } else if (a === 'replace' || a === 'replacing' || a === 'replaced') {
    // replace = one remove + one add
    state.addCount++
    state.removeCount++
  }
}
