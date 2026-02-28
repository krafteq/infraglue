import { describe, it, expect, vi } from 'vitest'
import { NonTtyRenderer } from './nontty-renderer.js'
import { WorkspaceApplyState } from './workspace-state.js'
import type { ProviderEvent } from '../providers/provider-events.js'

function createMockStream() {
  const lines: string[] = []
  return {
    write: vi.fn((data: string) => {
      lines.push(data)
      return true
    }),
    lines,
  } as unknown as NodeJS.WritableStream & { lines: string[] }
}

describe('NonTtyRenderer', () => {
  it('writes resource_start event', () => {
    const stream = createMockStream()
    const renderer = new NonTtyRenderer(stream)

    renderer.writeEvent('redis', {
      type: 'resource_start',
      address: 'docker_network.main',
      resourceType: 'docker_network',
      action: 'create',
    })

    expect(stream.lines[0]).toBe('[redis] create docker_network.main\n')
  })

  it('writes resource_complete event with elapsed', () => {
    const stream = createMockStream()
    const renderer = new NonTtyRenderer(stream)

    renderer.writeEvent('redis', {
      type: 'resource_complete',
      address: 'docker_network.main',
      action: 'create',
      elapsedSeconds: 12,
    })

    expect(stream.lines[0]).toBe('[redis] create docker_network.main (12s)\n')
  })

  it('writes resource_error event', () => {
    const stream = createMockStream()
    const renderer = new NonTtyRenderer(stream)

    renderer.writeEvent('postgres', {
      type: 'resource_error',
      address: 'aws_rds.main',
      message: 'DBInstanceAlreadyExists',
    })

    expect(stream.lines[0]).toBe('[postgres] error: aws_rds.main - DBInstanceAlreadyExists\n')
  })

  it('writes diagnostic error event', () => {
    const stream = createMockStream()
    const renderer = new NonTtyRenderer(stream)

    renderer.writeEvent('redis', {
      type: 'diagnostic',
      severity: 'error',
      summary: 'something broke',
      detail: '',
      address: null,
    })

    expect(stream.lines[0]).toBe('[redis] error: something broke\n')
  })

  it('writes diagnostic warning event', () => {
    const stream = createMockStream()
    const renderer = new NonTtyRenderer(stream)

    renderer.writeEvent('redis', {
      type: 'diagnostic',
      severity: 'warning',
      summary: 'deprecated',
      detail: '',
      address: null,
    })

    expect(stream.lines[0]).toBe('[redis] warning: deprecated\n')
  })

  it('skips info-level diagnostic events', () => {
    const stream = createMockStream()
    const renderer = new NonTtyRenderer(stream)

    renderer.writeEvent('redis', {
      type: 'diagnostic',
      severity: 'info',
      summary: 'something informational',
      detail: '',
      address: null,
    })

    expect(stream.lines).toHaveLength(0)
  })

  it('writes summary event', () => {
    const stream = createMockStream()
    const renderer = new NonTtyRenderer(stream)

    renderer.writeEvent('redis', {
      type: 'summary',
      add: 2,
      change: 1,
      remove: 0,
    })

    expect(stream.lines[0]).toBe('[redis] summary: +2 ~1 -0\n')
  })

  it('skips resource_progress events', () => {
    const stream = createMockStream()
    const renderer = new NonTtyRenderer(stream)

    renderer.writeEvent('redis', {
      type: 'resource_progress',
      address: 'docker_network.main',
      elapsedSeconds: 10,
    })

    expect(stream.lines).toHaveLength(0)
  })

  it('start and stop are no-ops', () => {
    const stream = createMockStream()
    const renderer = new NonTtyRenderer(stream)

    // Should not throw
    renderer.start()
    renderer.stop()
    expect(stream.lines).toHaveLength(0)
  })

  it('addWorkspace is a no-op', () => {
    const stream = createMockStream()
    const renderer = new NonTtyRenderer(stream)
    const ws = new WorkspaceApplyState('redis')

    renderer.addWorkspace(ws)
    expect(stream.lines).toHaveLength(0)
  })
})
