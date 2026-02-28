import logUpdate from 'log-update'
import pc from 'picocolors'
import type { WorkspaceApplyState, ResourceState } from './workspace-state.js'

export interface ILiveRenderer {
  addWorkspace(state: WorkspaceApplyState): void
  start(): void
  stop(): void
}

export class LiveRenderer implements ILiveRenderer {
  private readonly workspaces: WorkspaceApplyState[] = []
  private interval: ReturnType<typeof setInterval> | null = null
  private readonly verbose: boolean
  private readonly logUpdate: typeof logUpdate

  constructor(options?: { verbose?: boolean; logUpdateFn?: typeof logUpdate }) {
    this.verbose = options?.verbose ?? false
    this.logUpdate = options?.logUpdateFn ?? logUpdate
  }

  addWorkspace(state: WorkspaceApplyState): void {
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
    const output = this.verbose ? this.renderVerbose() : this.renderCompact()
    this.logUpdate(output)
  }

  renderCompact(): string {
    const lines: string[] = []
    for (const ws of this.workspaces) {
      lines.push(formatCompactLine(ws))
    }
    return lines.join('\n')
  }

  renderVerbose(): string {
    const lines: string[] = []
    for (const ws of this.workspaces) {
      lines.push(...formatVerboseBlock(ws))
    }
    return lines.join('\n')
  }
}

export const SLOW_RESOURCE_THRESHOLD_SECONDS = 60

export function formatCompactLine(ws: WorkspaceApplyState): string {
  const icon = ws.status === 'complete' ? pc.green('ok') : ws.status === 'failed' ? pc.red('X ') : pc.cyan('* ')
  const name = ws.name.padEnd(16)
  const progress = ws.totalCount > 0 ? `${ws.completedCount}/${ws.totalCount} resources` : ''
  const elapsed = `(${ws.elapsedSeconds}s)`

  if (ws.status === 'failed') {
    const errorDiag = ws.diagnostics.find((d) => d.severity === 'error')
    const errorMsg = errorDiag ? `  failed: ${errorDiag.summary}` : '  failed'
    return `  ${icon} ${name} ${progress.padEnd(16)} ${pc.red(errorMsg)}  ${pc.dim(elapsed)}`
  }

  const current = ws.currentResource
  const currentAction = current ? `${pc.dim(current.action)} ${pc.dim(shortAddress(current.address))}` : ''

  let line = `  ${icon} ${name} ${progress.padEnd(16)} ${currentAction}  ${pc.dim(elapsed)}`

  const slowResources = getSlowResources(ws, current?.address)
  for (const res of slowResources) {
    line += `\n       ${pc.dim(res.action)} ${pc.dim(shortAddress(res.address))}  ${pc.yellow(`(${res.elapsedSeconds}s)`)}`
  }

  return line
}

export function getSlowResources(ws: WorkspaceApplyState, currentAddress?: string): ResourceState[] {
  const slow: ResourceState[] = []
  for (const res of ws.resources.values()) {
    if (
      res.status === 'in-progress' &&
      res.elapsedSeconds >= SLOW_RESOURCE_THRESHOLD_SECONDS &&
      res.address !== currentAddress
    ) {
      slow.push(res)
    }
  }
  return slow
}

export function formatVerboseBlock(ws: WorkspaceApplyState): string[] {
  const lines: string[] = []
  const icon = ws.status === 'complete' ? pc.green('ok') : ws.status === 'failed' ? pc.red('X ') : pc.cyan('* ')
  lines.push(`  ${icon} ${ws.name}`)

  for (const res of ws.resources.values()) {
    const resIcon = res.status === 'complete' ? pc.green('ok') : res.status === 'failed' ? pc.red('X ') : pc.cyan('* ')
    const statusText =
      res.status === 'complete'
        ? pc.green(res.action)
        : res.status === 'failed'
          ? pc.red('failed')
          : pc.cyan(`${res.action}...`)
    const elapsed = res.elapsedSeconds > 0 ? pc.dim(`${res.elapsedSeconds}s`) : ''
    lines.push(`      ${resIcon} ${shortAddress(res.address).padEnd(40)} ${statusText.padEnd(20)} ${elapsed}`)
  }

  for (const diag of ws.diagnostics) {
    if (diag.severity === 'error') {
      lines.push(`      ${pc.red(`error: ${diag.address ?? ''} - ${diag.summary}`)}`)
    }
  }

  return lines
}

function shortAddress(address: string): string {
  // For Pulumi URNs, extract the type::name portion
  if (address.startsWith('urn:pulumi:')) {
    const parts = address.split('::')
    if (parts.length >= 4) {
      return `${parts[parts.length - 2]}::${parts[parts.length - 1]}`
    }
  }
  return address
}
