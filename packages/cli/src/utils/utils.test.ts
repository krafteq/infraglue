import { sortGraphNodesByLevels } from './utils'

describe('sortWorkspacesByLevels', () => {
  it('should handle empty workspaces', () => {
    const workspaces: [] = []
    const result = sortGraphNodesByLevels(workspaces, () => [])
    expect(result).toEqual([])
  })

  it('should handle workspaces with no dependencies', () => {
    const w1 = { id: '1', name: 'Workspace 1' }
    const w2 = { id: '2', name: 'Workspace 2' }
    const w3 = { id: '3', name: 'Workspace 3' }
    const workspaces = [w1, w2, w3]

    const result = sortGraphNodesByLevels(workspaces, () => [])

    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(3)
    expect(result[0]).toContain(w1)
    expect(result[0]).toContain(w2)
    expect(result[0]).toContain(w3)
  })

  it('should handle simple linear dependencies', () => {
    const w1 = { id: '1', name: 'Workspace 1' }
    const w2 = { id: '2', name: 'Workspace 2' }
    const w3 = { id: '3', name: 'Workspace 3' }
    const workspaces = [w1, w2, w3]

    const dependencies = new Map([
      [w2, [w1]],
      [w3, [w2]],
    ])

    const result = sortGraphNodesByLevels(workspaces, (node) => dependencies.get(node) || [])

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual([w1])
    expect(result[1]).toEqual([w2])
    expect(result[2]).toEqual([w3])
  })

  it('should handle parallel dependencies', () => {
    const w1 = { id: '1', name: 'Workspace 1' }
    const w2 = { id: '2', name: 'Workspace 2' }
    const w3 = { id: '3', name: 'Workspace 3' }
    const w4 = { id: '4', name: 'Workspace 4' }
    const workspaces = [w1, w2, w3, w4]

    const dependencies = new Map([
      [w3, [w1]],
      [w4, [w2]],
    ])

    const result = sortGraphNodesByLevels(workspaces, (node) => dependencies.get(node) || [])

    expect(result).toHaveLength(2)
    expect(result[0]).toHaveLength(2)
    expect(result[0]).toContain(w1)
    expect(result[0]).toContain(w2)
    expect(result[1]).toHaveLength(2)
    expect(result[1]).toContain(w3)
    expect(result[1]).toContain(w4)
  })

  it('should handle multiple dependencies on same level', () => {
    const w1 = { id: '1', name: 'Workspace 1' }
    const w2 = { id: '2', name: 'Workspace 2' }
    const w3 = { id: '3', name: 'Workspace 3' }
    const workspaces = [w1, w2, w3]

    const dependencies = new Map([[w3, [w1, w2]]])

    const result = sortGraphNodesByLevels(workspaces, (node) => dependencies.get(node) || [])

    expect(result).toHaveLength(2)
    expect(result[0]).toHaveLength(2)
    expect(result[0]).toContain(w1)
    expect(result[0]).toContain(w2)
    expect(result[1]).toEqual([w3])
  })

  it('should handle complex dependency graph', () => {
    const A = { id: 'A', name: 'A' }
    const B = { id: 'B', name: 'B' }
    const C = { id: 'C', name: 'C' }
    const D = { id: 'D', name: 'D' }
    const E = { id: 'E', name: 'E' }
    const F = { id: 'F', name: 'F' }
    const workspaces = [A, B, C, D, E, F]

    const dependencies = new Map([
      [B, [A]],
      [C, [A]],
      [D, [B, C, A]],
      [E, [C]],
      [F, [D, E]],
    ])

    const result = sortGraphNodesByLevels(workspaces, (node) => dependencies.get(node) || [])

    expect(result).toHaveLength(4)
    expect(result[0]).toEqual([A])
    expect(result[1]).toHaveLength(2)
    expect(result[1]).toContain(B)
    expect(result[1]).toContain(C)
    expect(result[2]).toHaveLength(2)
    expect(result[2]).toContain(D)
    expect(result[2]).toContain(E)
    expect(result[3]).toEqual([F])
  })

  it('should handle dependencies on non-existent workspaces', () => {
    const w1 = { id: '1', name: 'Workspace 1' }
    const w2 = { id: '2', name: 'Workspace 2' }
    const workspaces = [w1, w2]

    const nonExistent = { id: 'non-existent', name: 'non-existent' }

    expect(() => {
      sortGraphNodesByLevels(workspaces, (node) => {
        if (node === w2) {
          return [w1, nonExistent]
        }
        return []
      })
    }).toThrow("Workspace '1' depends on non-existent workspace")
  })

  it('should throw error for circular dependencies', () => {
    const w1 = { id: '1', name: 'Workspace 1' }
    const w2 = { id: '2', name: 'Workspace 2' }
    const workspaces = [w1, w2]

    const dependencies = new Map([
      [w1, [w2]],
      [w2, [w1]],
    ])

    expect(() => {
      sortGraphNodesByLevels(workspaces, (node) => dependencies.get(node) || [])
    }).toThrow('Circular dependency detected involving workspaces: [object Object], [object Object]')
  })

  it('should throw error for self-dependency', () => {
    const w1 = { id: '1', name: 'Workspace 1' }
    const workspaces = [w1]

    const dependencies = new Map([[w1, [w1]]])

    expect(() => {
      sortGraphNodesByLevels(workspaces, (node) => dependencies.get(node) || [])
    }).toThrow('Circular dependency detected involving workspaces: [object Object]')
  })

  it('should handle complex circular dependency', () => {
    const A = { id: 'A', name: 'A' }
    const B = { id: 'B', name: 'B' }
    const C = { id: 'C', name: 'C' }
    const D = { id: 'D', name: 'D' }
    const workspaces = [A, B, C, D]

    const dependencies = new Map([
      [A, [B]],
      [B, [C]],
      [C, [D]],
      [D, [A]],
    ])

    expect(() => {
      sortGraphNodesByLevels(workspaces, (node) => dependencies.get(node) || [])
    }).toThrow(
      'Circular dependency detected involving workspaces: [object Object], [object Object], [object Object], [object Object]',
    )
  })

  it('should work with different data types (generic)', () => {
    const w1 = 'string value'
    const w2 = 42
    const w3 = { complex: 'object' }
    const workspaces = [w1, w2, w3]

    const result = sortGraphNodesByLevels(workspaces, (node) => {
      if (node === w2) {
        return [w1]
      }
      if (node === w1) {
        return [w3]
      }
      return []
    })

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual([w3])
    expect(result[1]).toEqual([w1])
    expect(result[2]).toEqual([w2])
  })

  it('should handle mixed dependency scenarios', () => {
    const A = { id: 'A' }
    const B = { id: 'B' }
    const C = { id: 'C' }
    const D = { id: 'D' }
    const E = { id: 'E' }
    const workspaces = [A, B, C, D, E]

    const dependencies = new Map([
      [B, [A]],
      [C, [A]],
      [D, [B]],
      [E, [C, D]],
    ])

    const result = sortGraphNodesByLevels(workspaces, (node) => dependencies.get(node) || [])

    expect(result).toHaveLength(4)
    expect(result[0]).toEqual([A])
    expect(result[1]).toHaveLength(2)
    expect(result[1]).toContain(B)
    expect(result[1]).toContain(C)
    expect(result[2]).toEqual([D])
    expect(result[3]).toEqual([E])
  })

  it('should preserve order within same level', () => {
    const A = { id: 'A' }
    const B = { id: 'B' }
    const C = { id: 'C' }
    const workspaces = [A, B, C]

    const result = sortGraphNodesByLevels(workspaces, () => [])

    expect(result[0]).toHaveLength(3)
    // Order should be preserved as they appear in the workspaces object
    expect(result[0][0]).toBe(A)
    expect(result[0][1]).toBe(B)
    expect(result[0][2]).toBe(C)
  })
})
