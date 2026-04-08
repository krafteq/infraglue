import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PlanLiveRenderer, PlanNonTtyRenderer, formatPlanCompactLine } from './plan-live-renderer.js'
import { WorkspacePlanState } from './workspace-state.js'

describe('formatPlanCompactLine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
  })

  it('shows pending workspace', () => {
    const ws = new WorkspacePlanState('redis')
    const line = formatPlanCompactLine(ws)
    expect(line).toContain('redis')
    expect(line).toContain('waiting...')
  })

  it('shows planning workspace', () => {
    const ws = new WorkspacePlanState('redis')
    ws.markPlanning()
    const line = formatPlanCompactLine(ws)
    expect(line).toContain('redis')
    expect(line).toContain('planning...')
  })

  it('shows done workspace with change summary', () => {
    const ws = new WorkspacePlanState('postgres')
    vi.advanceTimersByTime(5000)
    ws.markDone({ add: 2, change: 1, remove: 0, replace: 0, outputUpdates: 0 })

    const line = formatPlanCompactLine(ws)
    expect(line).toContain('ok')
    expect(line).toContain('postgres')
    expect(line).toContain('+2 ~1 -0')
    expect(line).toContain('(5s)')
  })

  it('shows up-to-date workspace', () => {
    const ws = new WorkspacePlanState('express-service')
    ws.markUpToDate()
    vi.advanceTimersByTime(2000)

    const line = formatPlanCompactLine(ws)
    expect(line).toContain('ok')
    expect(line).toContain('express-service')
    expect(line).toContain('up to date')
  })

  it('shows failed workspace', () => {
    const ws = new WorkspacePlanState('auth-service')
    ws.markFailed('terraform init failed')
    vi.advanceTimersByTime(4000)

    const line = formatPlanCompactLine(ws)
    expect(line).toContain('X')
    expect(line).toContain('auth-service')
    expect(line).toContain('failed')
  })
})

describe('PlanLiveRenderer', () => {
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

    const renderer = new PlanLiveRenderer({ logUpdateFn: mockLogUpdate })
    const ws = new WorkspacePlanState('redis')
    renderer.addWorkspace(ws)
    renderer.start()

    vi.advanceTimersByTime(150)
    expect(updates.length).toBeGreaterThan(0)
    expect(updates[0]).toContain('redis')

    renderer.stop()
    expect(mockLogUpdate.done).toHaveBeenCalled()
  })

  it('renders multiple workspaces', () => {
    const updates: string[] = []
    const mockLogUpdate = Object.assign(
      (text: string) => {
        updates.push(text)
      },
      { done: vi.fn(), clear: vi.fn() },
    ) as unknown as typeof import('log-update').default

    const renderer = new PlanLiveRenderer({ logUpdateFn: mockLogUpdate })
    const ws1 = new WorkspacePlanState('redis')
    const ws2 = new WorkspacePlanState('postgres')
    ws1.markPlanning()
    ws2.markDone({ add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 })
    renderer.addWorkspace(ws1)
    renderer.addWorkspace(ws2)

    const output = renderer.renderCompact()
    expect(output).toContain('redis')
    expect(output).toContain('planning...')
    expect(output).toContain('postgres')
    expect(output).toContain('+1 ~0 -0')
  })

  it('start is idempotent', () => {
    const mockLogUpdate = Object.assign(() => {}, {
      done: vi.fn(),
      clear: vi.fn(),
    }) as unknown as typeof import('log-update').default

    const renderer = new PlanLiveRenderer({ logUpdateFn: mockLogUpdate })
    renderer.start()
    renderer.start()

    vi.advanceTimersByTime(250)
    renderer.stop()
    expect(mockLogUpdate.done).toHaveBeenCalledOnce()
  })
})

describe('PlanNonTtyRenderer', () => {
  it('writes status change lines to stream', () => {
    const written: string[] = []
    const mockStream = { write: (data: string) => written.push(data) } as unknown as NodeJS.WritableStream

    const renderer = new PlanNonTtyRenderer(mockStream)
    renderer.writeStatusChange('redis', 'planning...')
    renderer.writeStatusChange('postgres', '+2 ~1 -0 (5s)')

    expect(written).toEqual(['[redis] planning...\n', '[postgres] +2 ~1 -0 (5s)\n'])
  })

  it('addWorkspace, start, and stop are no-ops', () => {
    const renderer = new PlanNonTtyRenderer()
    const ws = new WorkspacePlanState('redis')
    // These should not throw
    renderer.addWorkspace(ws)
    renderer.start()
    renderer.stop()
  })
})
