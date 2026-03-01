import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkspaceApplyState, WorkspacePlanState } from './workspace-state.js'
import type { ProviderEvent } from '../providers/provider-events.js'

describe('WorkspaceApplyState', () => {
  let state: WorkspaceApplyState

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
    state = new WorkspaceApplyState('redis')
  })

  it('initializes with correct defaults', () => {
    expect(state.name).toBe('redis')
    expect(state.status).toBe('in-progress')
    expect(state.completedCount).toBe(0)
    expect(state.failedCount).toBe(0)
    expect(state.totalCount).toBe(0)
    expect(state.addCount).toBe(0)
    expect(state.changeCount).toBe(0)
    expect(state.removeCount).toBe(0)
    expect(state.diagnostics).toEqual([])
    expect(state.error).toBeNull()
  })

  it('handles resource_start event', () => {
    state.handleEvent({
      type: 'resource_start',
      address: 'docker_network.main',
      resourceType: 'docker_network',
      action: 'create',
    })

    expect(state.totalCount).toBe(1)
    expect(state.resources.size).toBe(1)
    const res = state.resources.get('docker_network.main')
    expect(res).toEqual({
      address: 'docker_network.main',
      action: 'create',
      status: 'in-progress',
      elapsedSeconds: 0,
    })
  })

  it('handles resource_progress event', () => {
    state.handleEvent({
      type: 'resource_start',
      address: 'docker_network.main',
      resourceType: 'docker_network',
      action: 'create',
    })
    state.handleEvent({
      type: 'resource_progress',
      address: 'docker_network.main',
      elapsedSeconds: 10,
    })

    const res = state.resources.get('docker_network.main')
    expect(res?.elapsedSeconds).toBe(10)
    expect(res?.status).toBe('in-progress')
  })

  it('handles resource_complete event and increments action count', () => {
    state.handleEvent({
      type: 'resource_start',
      address: 'docker_network.main',
      resourceType: 'docker_network',
      action: 'create',
    })
    state.handleEvent({
      type: 'resource_complete',
      address: 'docker_network.main',
      action: 'create',
      elapsedSeconds: 12,
    })

    expect(state.completedCount).toBe(1)
    expect(state.addCount).toBe(1)
    const res = state.resources.get('docker_network.main')
    expect(res?.status).toBe('complete')
    expect(res?.elapsedSeconds).toBe(12)
  })

  it('handles resource_error event', () => {
    state.handleEvent({
      type: 'resource_start',
      address: 'docker_container.app',
      resourceType: 'docker_container',
      action: 'create',
    })
    state.handleEvent({
      type: 'resource_error',
      address: 'docker_container.app',
      message: 'image not found',
    })

    expect(state.failedCount).toBe(1)
    const res = state.resources.get('docker_container.app')
    expect(res?.status).toBe('failed')
    expect(state.diagnostics).toEqual([
      { severity: 'error', summary: 'image not found', address: 'docker_container.app' },
    ])
  })

  it('handles diagnostic event', () => {
    state.handleEvent({
      type: 'diagnostic',
      severity: 'warning',
      summary: 'Deprecated',
      detail: 'some detail',
      address: 'docker_network.main',
    })

    expect(state.diagnostics).toEqual([{ severity: 'warning', summary: 'Deprecated', address: 'docker_network.main' }])
  })

  it('handles summary event when no resources tracked', () => {
    state.handleEvent({
      type: 'summary',
      add: 3,
      change: 1,
      remove: 0,
    })

    expect(state.totalCount).toBe(4)
    expect(state.addCount).toBe(3)
    expect(state.changeCount).toBe(1)
    expect(state.removeCount).toBe(0)
  })

  it('summary event overrides resource-derived counts with authoritative counts', () => {
    state.handleEvent({
      type: 'resource_start',
      address: 'a',
      resourceType: 'x',
      action: 'create',
    })
    state.handleEvent({
      type: 'resource_complete',
      address: 'a',
      action: 'create',
      elapsedSeconds: 1,
    })
    state.handleEvent({
      type: 'summary',
      add: 5,
      change: 0,
      remove: 0,
    })

    // Summary is authoritative for change counts
    expect(state.addCount).toBe(5)
    // But totalCount keeps the resource-tracked count
    expect(state.totalCount).toBe(1)
  })

  it('tracks multiple resources through full lifecycle', () => {
    const events: ProviderEvent[] = [
      { type: 'resource_start', address: 'a', resourceType: 'x', action: 'create' },
      { type: 'resource_start', address: 'b', resourceType: 'y', action: 'update' },
      { type: 'resource_complete', address: 'a', action: 'create', elapsedSeconds: 3 },
      { type: 'resource_error', address: 'b', message: 'failed' },
    ]

    for (const event of events) {
      state.handleEvent(event)
    }

    expect(state.totalCount).toBe(2)
    expect(state.completedCount).toBe(1)
    expect(state.failedCount).toBe(1)
    expect(state.addCount).toBe(1)
  })

  it('classifies delete action as removeCount', () => {
    state.handleEvent({ type: 'resource_start', address: 'a', resourceType: 'x', action: 'delete' })
    state.handleEvent({ type: 'resource_complete', address: 'a', action: 'delete', elapsedSeconds: 1 })
    expect(state.removeCount).toBe(1)
  })

  it('classifies update action as changeCount', () => {
    state.handleEvent({ type: 'resource_start', address: 'a', resourceType: 'x', action: 'update' })
    state.handleEvent({ type: 'resource_complete', address: 'a', action: 'update', elapsedSeconds: 1 })
    expect(state.changeCount).toBe(1)
  })

  it('classifies replace action as add + remove', () => {
    state.handleEvent({ type: 'resource_start', address: 'a', resourceType: 'x', action: 'replace' })
    state.handleEvent({ type: 'resource_complete', address: 'a', action: 'replace', elapsedSeconds: 1 })
    expect(state.addCount).toBe(1)
    expect(state.removeCount).toBe(1)
  })

  it('returns changeSummaryText', () => {
    state.handleEvent({ type: 'resource_start', address: 'a', resourceType: 'x', action: 'create' })
    state.handleEvent({ type: 'resource_complete', address: 'a', action: 'create', elapsedSeconds: 1 })
    state.handleEvent({ type: 'resource_start', address: 'b', resourceType: 'y', action: 'update' })
    state.handleEvent({ type: 'resource_complete', address: 'b', action: 'update', elapsedSeconds: 2 })
    expect(state.changeSummaryText).toBe('+1 ~1 -0')
  })

  it('markComplete sets status', () => {
    state.markComplete()
    expect(state.status).toBe('complete')
  })

  it('markFailed sets status and error', () => {
    state.markFailed('boom')
    expect(state.status).toBe('failed')
    expect(state.error).toBe('boom')
  })

  it('elapsedSeconds computes from start time', () => {
    vi.advanceTimersByTime(5000)
    expect(state.elapsedSeconds).toBe(5)
  })

  it('currentResource returns the first in-progress resource', () => {
    state.handleEvent({ type: 'resource_start', address: 'a', resourceType: 'x', action: 'create' })
    state.handleEvent({ type: 'resource_complete', address: 'a', action: 'create', elapsedSeconds: 1 })
    state.handleEvent({ type: 'resource_start', address: 'b', resourceType: 'y', action: 'update' })

    expect(state.currentResource?.address).toBe('b')
  })

  it('currentResource returns undefined when all complete', () => {
    state.handleEvent({ type: 'resource_start', address: 'a', resourceType: 'x', action: 'create' })
    state.handleEvent({ type: 'resource_complete', address: 'a', action: 'create', elapsedSeconds: 1 })

    expect(state.currentResource).toBeUndefined()
  })
})

describe('WorkspacePlanState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
  })

  it('initializes with correct defaults', () => {
    const state = new WorkspacePlanState('redis')
    expect(state.name).toBe('redis')
    expect(state.status).toBe('pending')
    expect(state.changeSummary).toBeNull()
    expect(state.error).toBeNull()
  })

  it('transitions through planning → done', () => {
    const state = new WorkspacePlanState('redis')
    state.markPlanning()
    expect(state.status).toBe('planning')

    state.markDone({ add: 2, change: 1, remove: 0, replace: 0, outputUpdates: 0 })
    expect(state.status).toBe('done')
    expect(state.changeSummary).toEqual({ add: 2, change: 1, remove: 0, replace: 0, outputUpdates: 0 })
  })

  it('transitions through planning → up-to-date', () => {
    const state = new WorkspacePlanState('redis')
    state.markPlanning()
    state.markUpToDate()
    expect(state.status).toBe('up-to-date')
  })

  it('transitions through planning → failed', () => {
    const state = new WorkspacePlanState('redis')
    state.markPlanning()
    state.markFailed('terraform init failed')
    expect(state.status).toBe('failed')
    expect(state.error).toBe('terraform init failed')
  })

  it('computes elapsedSeconds from start time', () => {
    const state = new WorkspacePlanState('redis')
    vi.advanceTimersByTime(7000)
    expect(state.elapsedSeconds).toBe(7)
  })
})
