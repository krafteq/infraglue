import type { ProviderEvent } from './provider-events.js'

export function parseTerraformStreamLine(line: string): ProviderEvent | null {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(line)
  } catch {
    return null
  }

  const type = obj.type as string | undefined

  if (type === 'apply_start' || type === 'resource_drift') {
    const hook = obj.hook as { resource?: { addr?: string; resource_type?: string }; action?: string } | undefined
    return {
      type: 'resource_start',
      address: hook?.resource?.addr ?? '',
      resourceType: hook?.resource?.resource_type ?? '',
      action: hook?.action ?? (obj.action as string) ?? 'apply',
    }
  }

  if (type === 'apply_progress') {
    const hook = obj.hook as { resource?: { addr?: string }; elapsed_seconds?: number } | undefined
    return {
      type: 'resource_progress',
      address: hook?.resource?.addr ?? '',
      elapsedSeconds: hook?.elapsed_seconds ?? 0,
    }
  }

  if (type === 'apply_complete') {
    const hook = obj.hook as { resource?: { addr?: string }; action?: string; elapsed_seconds?: number } | undefined
    return {
      type: 'resource_complete',
      address: hook?.resource?.addr ?? '',
      action: hook?.action ?? 'apply',
      elapsedSeconds: hook?.elapsed_seconds ?? 0,
    }
  }

  if (type === 'apply_errored') {
    const hook = obj.hook as { resource?: { addr?: string } } | undefined
    const diag = obj.diagnostic as { summary?: string; detail?: string } | undefined
    return {
      type: 'resource_error',
      address: hook?.resource?.addr ?? '',
      message: diag?.summary ?? (obj['@message'] as string) ?? 'unknown error',
    }
  }

  if (type === 'diagnostic') {
    const diag = obj.diagnostic as {
      severity?: string
      summary?: string
      detail?: string
      address?: string | null
    } | null
    if (!diag) return null
    return {
      type: 'diagnostic',
      severity: diag.severity === 'error' ? 'error' : diag.severity === 'warning' ? 'warning' : 'info',
      summary: diag.summary ?? '',
      detail: diag.detail ?? '',
      address: diag.address ?? null,
    }
  }

  if (type === 'change_summary') {
    const changes = obj.changes as { add?: number; change?: number; remove?: number } | undefined
    return {
      type: 'summary',
      add: changes?.add ?? 0,
      change: changes?.change ?? 0,
      remove: changes?.remove ?? 0,
    }
  }

  return null
}

export function parsePulumiStreamLine(line: string): ProviderEvent | null {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(line)
  } catch {
    return null
  }

  if (obj.resourcePreEvent) {
    const ev = obj.resourcePreEvent as {
      metadata?: { urn?: string; type?: string; op?: string }
    }
    const urn = ev.metadata?.urn ?? ''
    return {
      type: 'resource_start',
      address: urn,
      resourceType: ev.metadata?.type ?? extractPulumiType(urn),
      action: ev.metadata?.op ?? 'update',
    }
  }

  if (obj.resOutputsEvent) {
    const ev = obj.resOutputsEvent as {
      metadata?: { urn?: string; op?: string; durationSeconds?: number }
    }
    return {
      type: 'resource_complete',
      address: ev.metadata?.urn ?? '',
      action: ev.metadata?.op ?? 'update',
      elapsedSeconds: ev.metadata?.durationSeconds ?? 0,
    }
  }

  if (obj.resOpFailedEvent) {
    const ev = obj.resOpFailedEvent as {
      metadata?: { urn?: string }
      status?: number
      diagnostics?: Array<{ message?: string }>
    }
    const message = ev.diagnostics?.[0]?.message ?? `resource operation failed with status ${ev.status ?? 'unknown'}`
    return {
      type: 'resource_error',
      address: ev.metadata?.urn ?? '',
      message,
    }
  }

  if (obj.diagnosticEvent) {
    const ev = obj.diagnosticEvent as {
      severity?: string
      message?: string
      urn?: string
    }
    const severity = ev.severity
    return {
      type: 'diagnostic',
      severity: severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'info',
      summary: ev.message ?? '',
      detail: '',
      address: ev.urn ?? null,
    }
  }

  if (obj.summaryEvent) {
    const ev = obj.summaryEvent as {
      resourceChanges?: Record<string, number>
    }
    const rc = ev.resourceChanges ?? {}
    return {
      type: 'summary',
      add: rc.create ?? 0,
      change: rc.update ?? 0,
      remove: rc.delete ?? 0,
    }
  }

  return null
}

function extractPulumiType(urn: string): string {
  // urn:pulumi:stack::project::type::name
  const parts = urn.split('::')
  return parts.length >= 3 ? parts[parts.length - 2] : ''
}
