export interface ResourceStartEvent {
  type: 'resource_start'
  address: string
  resourceType: string
  action: string
}

export interface ResourceProgressEvent {
  type: 'resource_progress'
  address: string
  elapsedSeconds: number
}

export interface ResourceCompleteEvent {
  type: 'resource_complete'
  address: string
  action: string
  elapsedSeconds: number
}

export interface ResourceErrorEvent {
  type: 'resource_error'
  address: string
  message: string
}

export interface DiagnosticEvent {
  type: 'diagnostic'
  severity: 'error' | 'warning' | 'info'
  summary: string
  detail: string
  address: string | null
}

export interface SummaryEvent {
  type: 'summary'
  add: number
  change: number
  remove: number
}

export type ProviderEvent =
  | ResourceStartEvent
  | ResourceProgressEvent
  | ResourceCompleteEvent
  | ResourceErrorEvent
  | DiagnosticEvent
  | SummaryEvent
