import { sortWorkspacesByLevels } from './utils'

describe('sortWorkspacesByLevels', () => {
  it('should handle empty workspaces', () => {
    const workspaces = {}
    const dependencies = {}

    const result = sortWorkspacesByLevels(workspaces, dependencies)

    expect(result).toEqual([])
  })

  it('should handle workspaces with no dependencies', () => {
    const workspaces = {
      workspace1: { id: '1', name: 'Workspace 1' },
      workspace2: { id: '2', name: 'Workspace 2' },
      workspace3: { id: '3', name: 'Workspace 3' },
    }
    const dependencies = {}

    const result = sortWorkspacesByLevels(workspaces, dependencies)

    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(3)
    expect(result[0]).toContain(workspaces['workspace1'])
    expect(result[0]).toContain(workspaces['workspace2'])
    expect(result[0]).toContain(workspaces['workspace3'])
  })

  it('should handle simple linear dependencies', () => {
    const workspaces = {
      workspace1: { id: '1', name: 'Workspace 1' },
      workspace2: { id: '2', name: 'Workspace 2' },
      workspace3: { id: '3', name: 'Workspace 3' },
    }
    const dependencies = {
      workspace2: ['workspace1'],
      workspace3: ['workspace2'],
    }

    const result = sortWorkspacesByLevels(workspaces, dependencies)

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual([workspaces['workspace1']])
    expect(result[1]).toEqual([workspaces['workspace2']])
    expect(result[2]).toEqual([workspaces['workspace3']])
  })

  it('should handle parallel dependencies', () => {
    const workspaces = {
      workspace1: { id: '1', name: 'Workspace 1' },
      workspace2: { id: '2', name: 'Workspace 2' },
      workspace3: { id: '3', name: 'Workspace 3' },
      workspace4: { id: '4', name: 'Workspace 4' },
    }
    const dependencies = {
      workspace3: ['workspace1'],
      workspace4: ['workspace2'],
    }

    const result = sortWorkspacesByLevels(workspaces, dependencies)

    expect(result).toHaveLength(2)
    expect(result[0]).toHaveLength(2)
    expect(result[0]).toContain(workspaces['workspace1'])
    expect(result[0]).toContain(workspaces['workspace2'])
    expect(result[1]).toHaveLength(2)
    expect(result[1]).toContain(workspaces['workspace3'])
    expect(result[1]).toContain(workspaces['workspace4'])
  })

  it('should handle multiple dependencies on same level', () => {
    const workspaces = {
      workspace1: { id: '1', name: 'Workspace 1' },
      workspace2: { id: '2', name: 'Workspace 2' },
      workspace3: { id: '3', name: 'Workspace 3' },
    }
    const dependencies = {
      workspace3: ['workspace1', 'workspace2'],
    }

    const result = sortWorkspacesByLevels(workspaces, dependencies)

    expect(result).toHaveLength(2)
    expect(result[0]).toHaveLength(2)
    expect(result[0]).toContain(workspaces['workspace1'])
    expect(result[0]).toContain(workspaces['workspace2'])
    expect(result[1]).toEqual([workspaces['workspace3']])
  })

  it('should handle complex dependency graph', () => {
    const workspaces = {
      A: { id: 'A', name: 'A' },
      B: { id: 'B', name: 'B' },
      C: { id: 'C', name: 'C' },
      D: { id: 'D', name: 'D' },
      E: { id: 'E', name: 'E' },
      F: { id: 'F', name: 'F' },
    }
    const dependencies = {
      B: ['A'],
      C: ['A'],
      D: ['B', 'C', 'A'],
      E: ['C'],
      F: ['D', 'E'],
    }

    const result = sortWorkspacesByLevels(workspaces, dependencies)

    expect(result).toHaveLength(4)
    expect(result[0]).toEqual([workspaces['A']])
    expect(result[1]).toHaveLength(2)
    expect(result[1]).toContain(workspaces['B'])
    expect(result[1]).toContain(workspaces['C'])
    expect(result[2]).toHaveLength(2)
    expect(result[2]).toContain(workspaces['D'])
    expect(result[2]).toContain(workspaces['E'])
    expect(result[3]).toEqual([workspaces['F']])
  })

  it('should handle dependencies on non-existent workspaces', () => {
    const workspaces = {
      workspace1: { id: '1', name: 'Workspace 1' },
      workspace2: { id: '2', name: 'Workspace 2' },
    }
    const dependencies = {
      workspace2: ['workspace1', 'non-existent'],
    }

    expect(() => {
      sortWorkspacesByLevels(workspaces, dependencies)
    }).toThrow("Workspace 'workspace2' depends on non-existent workspace 'non-existent'")
  })

  it('should throw error for circular dependencies', () => {
    const workspaces = {
      workspace1: { id: '1', name: 'Workspace 1' },
      workspace2: { id: '2', name: 'Workspace 2' },
    }
    const dependencies = {
      workspace1: ['workspace2'],
      workspace2: ['workspace1'],
    }

    expect(() => {
      sortWorkspacesByLevels(workspaces, dependencies)
    }).toThrow('Circular dependency detected involving workspaces: workspace1, workspace2')
  })

  it('should throw error for self-dependency', () => {
    const workspaces = {
      workspace1: { id: '1', name: 'Workspace 1' },
    }
    const dependencies = {
      workspace1: ['workspace1'],
    }

    expect(() => {
      sortWorkspacesByLevels(workspaces, dependencies)
    }).toThrow('Circular dependency detected involving workspaces: workspace1')
  })

  it('should handle complex circular dependency', () => {
    const workspaces = {
      A: { id: 'A', name: 'A' },
      B: { id: 'B', name: 'B' },
      C: { id: 'C', name: 'C' },
      D: { id: 'D', name: 'D' },
    }
    const dependencies = {
      A: ['B'],
      B: ['C'],
      C: ['D'],
      D: ['A'],
    }

    expect(() => {
      sortWorkspacesByLevels(workspaces, dependencies)
    }).toThrow('Circular dependency detected involving workspaces: A, B, C, D')
  })

  it('should work with different data types (generic)', () => {
    const workspaces = {
      workspace1: 'string value',
      workspace2: 42,
      workspace3: { complex: 'object' },
    }
    const dependencies = {
      workspace2: ['workspace1'],
      workspace1: ['workspace3'],
    }

    const result = sortWorkspacesByLevels(workspaces, dependencies)

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual([{ complex: 'object' }])
    expect(result[1]).toEqual(['string value'])
    expect(result[2]).toEqual([42])
  })

  it('should handle mixed dependency scenarios', () => {
    const workspaces = {
      A: { id: 'A' },
      B: { id: 'B' },
      C: { id: 'C' },
      D: { id: 'D' },
      E: { id: 'E' },
    }
    const dependencies = {
      B: ['A'],
      C: ['A'],
      D: ['B'],
      E: ['C', 'D'],
    }

    const result = sortWorkspacesByLevels(workspaces, dependencies)

    expect(result).toHaveLength(4)
    expect(result[0]).toEqual([workspaces['A']])
    expect(result[1]).toHaveLength(2)
    expect(result[1]).toContain(workspaces['B'])
    expect(result[1]).toContain(workspaces['C'])
    expect(result[2]).toEqual([workspaces['D']])
    expect(result[3]).toEqual([workspaces['E']])
  })

  it('should preserve order within same level', () => {
    const workspaces = {
      A: { id: 'A' },
      B: { id: 'B' },
      C: { id: 'C' },
    }
    const dependencies = {}

    const result = sortWorkspacesByLevels(workspaces, dependencies)

    expect(result[0]).toHaveLength(3)
    // Order should be preserved as they appear in the workspaces object
    expect(result[0][0]).toBe(workspaces['A'])
    expect(result[0][1]).toBe(workspaces['B'])
    expect(result[0][2]).toBe(workspaces['C'])
  })
})
