export function sortGraphNodesByLevels<T>(nodes: T[], dependencies: (n: T) => T[]): T[][] {
  const heightsMemo: Record<number, number> = {}
  const path: number[] = []

  // height(N) = max(height(M)) + 1, where M is every dependency of N
  const calcHeightRec = (node: number) => {
    if (heightsMemo[node] !== undefined) {
      return heightsMemo[node]
    }

    if (path.includes(node)) {
      throw new Error(`Circular dependency detected involving workspaces: ${path.map((p) => nodes[p]).join(', ')}`)
    }

    path.push(node)
    let max = 0
    for (const dep of dependencies(nodes[node]) ?? []) {
      const depNode = nodes.findIndex((x) => x === dep)
      if (depNode === -1) {
        throw new Error(`Workspace '${node}' depends on non-existent workspace`)
      }
      max = Math.max(max, calcHeightRec(depNode))
    }

    path.pop()

    return (heightsMemo[node] = max + 1)
  }
  const levels: T[][] = []

  for (let i = 0; i < nodes.length; i++) {
    const level = calcHeightRec(i) - 1
    if (!levels[level]) {
      levels[level] = []
    }
    levels[level].push(nodes[i])
  }

  return levels
}
