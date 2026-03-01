import logUpdate from 'log-update'
import pc from 'picocolors'
import type { WorkspacePlanState } from './workspace-state.js'

export interface IPlanRenderer {
  addWorkspace(state: WorkspacePlanState): void
  start(): void
  stop(): void
}

export class PlanLiveRenderer implements IPlanRenderer {
  private readonly workspaces: WorkspacePlanState[] = []
  private interval: ReturnType<typeof setInterval> | null = null
  private readonly logUpdate: typeof logUpdate

  constructor(options?: { logUpdateFn?: typeof logUpdate }) {
    this.logUpdate = options?.logUpdateFn ?? logUpdate
  }

  addWorkspace(state: WorkspacePlanState): void {
    this.workspaces.push(state)
  }

  start(): void {
    if (this.interval) return
    this.interval = setInterval(() => {
      this.render()
    }, 100)
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    this.render()
    this.logUpdate.done()
  }

  private render(): void {
    this.logUpdate(this.renderCompact())
  }

  renderCompact(): string {
    return this.workspaces.map((ws) => formatPlanCompactLine(ws)).join('\n')
  }
}

export class PlanNonTtyRenderer implements IPlanRenderer {
  private readonly stream: NodeJS.WritableStream

  constructor(stream?: NodeJS.WritableStream) {
    this.stream = stream ?? process.stderr
  }

  addWorkspace(_state: WorkspacePlanState): void {
    // no-op — we write status changes directly
  }

  start(): void {
    // no-op
  }

  stop(): void {
    // no-op
  }

  writeStatusChange(workspaceName: string, message: string): void {
    this.stream.write(`[${workspaceName}] ${message}\n`)
  }
}

export function formatPlanCompactLine(ws: WorkspacePlanState): string {
  const elapsed = `(${ws.elapsedSeconds}s)`

  switch (ws.status) {
    case 'pending': {
      const icon = pc.dim('--')
      const name = ws.name.padEnd(20)
      return `  ${icon} ${name} ${pc.dim('waiting...')}  ${pc.dim(elapsed)}`
    }
    case 'planning': {
      const icon = pc.cyan('* ')
      const name = ws.name.padEnd(20)
      return `  ${icon} ${name} ${pc.cyan('planning...')}  ${pc.dim(elapsed)}`
    }
    case 'done': {
      const icon = pc.green('ok')
      const name = ws.name.padEnd(20)
      const cs = ws.changeSummary
      const summary = cs ? `+${cs.add} ~${cs.change} -${cs.remove}` : ''
      return `  ${icon} ${name} ${summary}  ${pc.dim(elapsed)}`
    }
    case 'up-to-date': {
      const icon = pc.green('ok')
      const name = ws.name.padEnd(20)
      return `  ${icon} ${name} ${pc.dim('up to date')}  ${pc.dim(elapsed)}`
    }
    case 'failed': {
      const icon = pc.red('X ')
      const name = ws.name.padEnd(20)
      return `  ${icon} ${name} ${pc.red('failed')}  ${pc.dim(elapsed)}`
    }
  }
}
