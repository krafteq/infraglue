/**
 * Sorts workspaces by dependency levels using Kahn's Algorithm.
 * Returns an array of arrays where each inner array contains workspaces
 * that can be processed at the same level.
 *
 * Time Complexity: O(V + E)
 * Space Complexity: O(V + E)
 *
 * @param workspaces - Record of workspace paths to PlatformDetectionResult
 * @param dependencies - Record of workspace paths to their dependency arrays
 * @returns Array of arrays, each containing workspaces for a specific level
 * @throws Error if circular dependencies are detected or if a workspace depends on a non-existent workspace
 */
export function sortWorkspacesByLevels<T>(
  workspaces: Record<string, T>,
  dependencies: Record<string, string[]>,
): T[][] {
  const levels: T[][] = []
  const workspaceKeys = Object.keys(workspaces)

  // Calculate in-degrees for each workspace
  const inDegree: Record<string, number> = {}
  const adjacencyList: Record<string, string[]> = {}

  // Initialize in-degrees and adjacency list
  for (const workspace of workspaceKeys) {
    inDegree[workspace] = 0
    adjacencyList[workspace] = []
  }

  // Build adjacency list and calculate in-degrees
  for (const workspace of workspaceKeys) {
    const deps = dependencies[workspace] || []
    for (const dep of deps) {
      if (!workspaces[dep]) {
        throw new Error(`Workspace '${workspace}' depends on non-existent workspace '${dep}'`)
      }
      adjacencyList[dep].push(workspace)
      inDegree[workspace]++
    }
  }

  // Find all workspaces with no dependencies (level 0)
  const queue: Array<{ workspace: string; level: number }> = []
  for (const workspace of workspaceKeys) {
    if (inDegree[workspace] === 0) {
      queue.push({ workspace, level: 0 })
    }
  }

  // Process workspaces level by level
  let processedCount = 0
  while (queue.length > 0) {
    const { workspace, level } = queue.shift()!
    processedCount++

    // Ensure level array exists
    if (!levels[level]) {
      levels[level] = []
    }

    // Add workspace to current level
    levels[level].push(workspaces[workspace])

    // Process all workspaces that depend on this one
    for (const dependent of adjacencyList[workspace]) {
      inDegree[dependent]--
      if (inDegree[dependent] === 0) {
        queue.push({ workspace: dependent, level: level + 1 })
      }
    }
  }

  // Check for circular dependencies
  if (processedCount !== workspaceKeys.length) {
    // Find the workspaces involved in circular dependencies
    const circularWorkspaces: string[] = []
    for (const workspace of workspaceKeys) {
      if (inDegree[workspace] > 0) {
        circularWorkspaces.push(workspace)
      }
    }
    throw new Error(`Circular dependency detected involving workspaces: ${circularWorkspaces.join(', ')}`)
  }

  return levels
}
