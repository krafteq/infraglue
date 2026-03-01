import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  LiveRenderer,
  formatCompactLine,
  formatVerboseBlock,
  SLOW_RESOURCE_THRESHOLD_SECONDS,
} from './live-renderer.js'
import { WorkspaceApplyState } from './workspace-state.js'

describe('formatCompactLine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
  })

  it('shows in-progress workspace with current resource', () => {
    const ws = new WorkspaceApplyState('redis')
    ws.handleEvent({
      type: 'resource_start',
      address: 'docker:index:Container',
      resourceType: 'docker',
      action: 'creating',
    })
    ws.handleEvent({ type: 'resource_start', address: 'docker:index:Image', resourceType: 'docker', action: 'pulling' })
    ws.handleEvent({ type: 'resource_complete', address: 'docker:index:Image', action: 'pulling', elapsedSeconds: 1 })

    const line = formatCompactLine(ws)
    expect(line).toContain('redis')
    expect(line).toContain('1/2')
    expect(line).toContain('creating')
  })

  it('shows completed workspace', () => {
    const ws = new WorkspaceApplyState('postgres')
    ws.markComplete()
    vi.advanceTimersByTime(3000)

    const line = formatCompactLine(ws)
    expect(line).toContain('ok')
    expect(line).toContain('postgres')
  })

  it('shows failed workspace with error message', () => {
    const ws = new WorkspaceApplyState('postgres')
    ws.handleEvent({ type: 'resource_start', address: 'aws:rds:Instance', resourceType: 'aws', action: 'create' })
    ws.handleEvent({ type: 'resource_error', address: 'aws:rds:Instance', message: 'DBInstanceAlreadyExists' })
    ws.markFailed('DBInstanceAlreadyExists')

    const line = formatCompactLine(ws)
    expect(line).toContain('X')
    expect(line).toContain('postgres')
    expect(line).toContain('failed')
    expect(line).toContain('DBInstanceAlreadyExists')
  })
})

describe('formatCompactLine slow resources', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
  })

  it('shows slow resource (>=60s) as additional line', () => {
    const ws = new WorkspaceApplyState('redis')
    ws.handleEvent({
      type: 'resource_start',
      address: 'docker:index:Container',
      resourceType: 'docker',
      action: 'creating',
    })
    ws.handleEvent({
      type: 'resource_start',
      address: 'aws:rds:Instance::database',
      resourceType: 'aws',
      action: 'creating',
    })
    // Make the second resource slow
    ws.handleEvent({
      type: 'resource_progress',
      address: 'aws:rds:Instance::database',
      elapsedSeconds: SLOW_RESOURCE_THRESHOLD_SECONDS,
    })

    const line = formatCompactLine(ws)
    // Main line shows the first in-progress resource (Container)
    expect(line).toContain('docker:index:Container')
    // Slow resource appears as additional line
    expect(line).toContain('aws:rds:Instance::database')
    expect(line).toContain(`${SLOW_RESOURCE_THRESHOLD_SECONDS}s`)
  })

  it('does not show extra lines when all resources are under threshold', () => {
    const ws = new WorkspaceApplyState('redis')
    ws.handleEvent({
      type: 'resource_start',
      address: 'docker:index:Container',
      resourceType: 'docker',
      action: 'creating',
    })
    ws.handleEvent({
      type: 'resource_start',
      address: 'aws:rds:Instance::database',
      resourceType: 'aws',
      action: 'creating',
    })
    ws.handleEvent({
      type: 'resource_progress',
      address: 'aws:rds:Instance::database',
      elapsedSeconds: 30,
    })

    const line = formatCompactLine(ws)
    // Should be a single line (no newlines)
    expect(line.split('\n')).toHaveLength(1)
  })

  it('does not duplicate current resource even if slow', () => {
    const ws = new WorkspaceApplyState('redis')
    ws.handleEvent({
      type: 'resource_start',
      address: 'docker:index:Container',
      resourceType: 'docker',
      action: 'creating',
    })
    // Make the current resource slow
    ws.handleEvent({
      type: 'resource_progress',
      address: 'docker:index:Container',
      elapsedSeconds: 120,
    })

    const line = formatCompactLine(ws)
    // Should be a single line — the current resource is already on the main line
    expect(line.split('\n')).toHaveLength(1)
    expect(line).toContain('docker:index:Container')
  })

  it('shows multiple slow resources each on their own line', () => {
    const ws = new WorkspaceApplyState('infra')
    ws.handleEvent({
      type: 'resource_start',
      address: 'docker:index:Container',
      resourceType: 'docker',
      action: 'creating',
    })
    ws.handleEvent({
      type: 'resource_start',
      address: 'aws:rds:Instance::db1',
      resourceType: 'aws',
      action: 'creating',
    })
    ws.handleEvent({
      type: 'resource_start',
      address: 'aws:rds:Instance::db2',
      resourceType: 'aws',
      action: 'creating',
    })
    ws.handleEvent({
      type: 'resource_progress',
      address: 'aws:rds:Instance::db1',
      elapsedSeconds: 90,
    })
    ws.handleEvent({
      type: 'resource_progress',
      address: 'aws:rds:Instance::db2',
      elapsedSeconds: 75,
    })

    const line = formatCompactLine(ws)
    const lines = line.split('\n')
    // Main line + 2 slow resource lines
    expect(lines).toHaveLength(3)
    expect(line).toContain('aws:rds:Instance::db1')
    expect(line).toContain('aws:rds:Instance::db2')
  })
})

describe('formatVerboseBlock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
  })

  it('shows per-resource detail', () => {
    const ws = new WorkspaceApplyState('redis')
    ws.handleEvent({ type: 'resource_start', address: 'docker:index:Image', resourceType: 'docker', action: 'pulled' })
    ws.handleEvent({ type: 'resource_complete', address: 'docker:index:Image', action: 'pulled', elapsedSeconds: 1 })
    ws.handleEvent({
      type: 'resource_start',
      address: 'docker:index:Container',
      resourceType: 'docker',
      action: 'creating',
    })

    const lines = formatVerboseBlock(ws)
    expect(lines.length).toBeGreaterThanOrEqual(3) // header + 2 resources
    expect(lines[0]).toContain('redis')
    expect(lines.some((l) => l.includes('docker:index:Image'))).toBe(true)
    expect(lines.some((l) => l.includes('docker:index:Container'))).toBe(true)
  })

  it('shows error diagnostics', () => {
    const ws = new WorkspaceApplyState('postgres')
    ws.handleEvent({ type: 'resource_start', address: 'aws:rds:Instance', resourceType: 'aws', action: 'create' })
    ws.handleEvent({ type: 'resource_error', address: 'aws:rds:Instance', message: 'DBInstanceAlreadyExists' })

    const lines = formatVerboseBlock(ws)
    expect(lines.some((l) => l.includes('error') && l.includes('DBInstanceAlreadyExists'))).toBe(true)
  })
})

describe('LiveRenderer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
  })

  it('renders workspaces on interval', () => {
    const updates: string[] = []
    const mockLogUpdate = Object.assign(
      (text: string) => {
        updates.push(text)
      },
      { done: vi.fn(), clear: vi.fn() },
    ) as unknown as typeof import('log-update').default

    const renderer = new LiveRenderer({ logUpdateFn: mockLogUpdate })
    const ws = new WorkspaceApplyState('redis')
    renderer.addWorkspace(ws)
    renderer.start()

    vi.advanceTimersByTime(150) // at least one 100ms tick
    expect(updates.length).toBeGreaterThan(0)
    expect(updates[0]).toContain('redis')

    renderer.stop()
    expect(mockLogUpdate.done).toHaveBeenCalled()
  })

  it('renders verbose when verbose option set', () => {
    const updates: string[] = []
    const mockLogUpdate = Object.assign(
      (text: string) => {
        updates.push(text)
      },
      { done: vi.fn(), clear: vi.fn() },
    ) as unknown as typeof import('log-update').default

    const renderer = new LiveRenderer({ verbose: true, logUpdateFn: mockLogUpdate })
    const ws = new WorkspaceApplyState('redis')
    ws.handleEvent({ type: 'resource_start', address: 'docker:index:Image', resourceType: 'docker', action: 'pull' })
    renderer.addWorkspace(ws)
    renderer.start()

    vi.advanceTimersByTime(150)
    expect(updates.length).toBeGreaterThan(0)
    // verbose should contain the resource address within the output
    expect(updates[updates.length - 1]).toContain('docker:index:Image')

    renderer.stop()
  })

  it('start is idempotent', () => {
    const mockLogUpdate = Object.assign(() => {}, {
      done: vi.fn(),
      clear: vi.fn(),
    }) as unknown as typeof import('log-update').default

    const renderer = new LiveRenderer({ logUpdateFn: mockLogUpdate })
    renderer.start()
    renderer.start() // should not create a second interval

    vi.advanceTimersByTime(250)
    renderer.stop()
    // If two intervals were created, done would have issues; just check no error
    expect(mockLogUpdate.done).toHaveBeenCalledOnce()
  })
})
