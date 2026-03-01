import type { ProviderEvent } from '../providers/provider-events.js'
import type { ILiveRenderer } from './live-renderer.js'
import type { WorkspaceApplyState } from './workspace-state.js'

export class NonTtyRenderer implements ILiveRenderer {
  private readonly stream: NodeJS.WritableStream

  constructor(stream?: NodeJS.WritableStream) {
    this.stream = stream ?? process.stderr
  }

  addWorkspace(_state: WorkspaceApplyState): void {
    // no-op — we write events directly as they come
  }

  start(): void {
    // no-op
  }

  stop(): void {
    // no-op
  }

  writeEvent(workspaceName: string, event: ProviderEvent): void {
    const prefix = `[${workspaceName}]`

    switch (event.type) {
      case 'resource_start':
        this.write(`${prefix} ${event.action} ${event.address}`)
        break
      case 'resource_complete':
        this.write(`${prefix} ${event.action} ${event.address} (${event.elapsedSeconds}s)`)
        break
      case 'resource_error':
        this.write(`${prefix} error: ${event.address} - ${event.message}`)
        break
      case 'diagnostic':
        if (event.severity === 'error' || event.severity === 'warning') {
          this.write(`${prefix} ${event.severity}: ${event.summary}`)
        }
        break
      case 'summary':
        this.write(`${prefix} summary: +${event.add} ~${event.change} -${event.remove}`)
        break
      case 'resource_progress':
        // skip progress events in CI — too noisy
        break
    }
  }

  private write(line: string): void {
    this.stream.write(`${line}\n`)
  }
}
