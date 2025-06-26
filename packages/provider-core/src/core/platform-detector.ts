/**
 * PlatformDetector class for detecting and managing platform configurations.
 *
 * @example
 * import { PlatformDetector } from '@infra-glue/provider-core'
 *
 * const detector = new PlatformDetector()
 * const result = await detector.detectPlatform('/path/to/project')
 *
 * console.log('Workspaces found:', result.workspaces.size)
 * console.log('Execution order:', detector.getExecutionOrder(result.workspaces))
 *
 * // Check for validation errors
 * const errors = detector.validateConfiguration(result)
 * if (errors.length > 0) {
 *   console.error('Configuration errors:', errors)
 * }
 */

// TODO: it is probably should be moved to a separate package
import { readFile } from 'fs'
import { join } from 'path'
import { parse as parseYaml } from 'yaml'
import { promisify } from 'util'
import { glob } from 'glob'

const readFileAsync = promisify(readFile)

export interface PlatformConfig {
  workspace?: string[]
  defaults?: {
    provider?: string
    [key: string]: unknown
  }
  provider?: string
  injection?: Record<string, string>
  output?: Record<string, string>
  [key: string]: unknown
}

export interface PlatformInjection {
  workspace: string | null
  key: string
}

export interface PlatformDetectionResult {
  rootPath: string
  provider: string
  workspaces: Record<string, PlatformDetectionResult>
  injections: Record<string, PlatformInjection>
  output?: Record<string, PlatformInjection>
}

const CONFIG_FILE_NAME = 'platform-config.yaml'
const DEFAULT_ENCODING = 'utf-8'

async function readConfigFile(fileName: string): Promise<PlatformConfig | null> {
  try {
    const content = await readFileAsync(fileName, DEFAULT_ENCODING)
    return parseYaml(content)
  } catch (error) {
    console.error(`Error reading config file ${fileName}:`, error)
    return null
  }
}

export async function getPlatformConfiguration(
  rootPath: string = process.cwd(),
): Promise<PlatformDetectionResult | null> {
  const fileName = join(rootPath, CONFIG_FILE_NAME)
  const config = await readConfigFile(fileName)
  if (!config) {
    return null
  }

  const workspaces = await readWorkspacesRecursively(config, rootPath)
  const result: PlatformDetectionResult = {
    rootPath,
    provider: config.provider || 'platform',
    workspaces,
    injections: {},
    output: {},
  }
  if (config.injection) {
    result.injections = {}
    for (const key in config.injection) {
      const workspaceInjection = config.injection[key].split(':')
      if (workspaceInjection.length === 1) {
        result.injections[key] = { workspace: null, key: workspaceInjection[0] }
      } else if (workspaceInjection.length === 2) {
        result.injections[key] = { workspace: join(rootPath, workspaceInjection[0]), key: workspaceInjection[1] }
      } else {
        throw new Error(`Invalid injection ${key}: ${config.injection[key]}`)
      }
    }
  }
  if (config.output) {
    result.output = {}
    for (const key in config.output) {
      const [workspace, outputKey] = config.output[key].split(':')
      result.output[key] = { workspace: join(rootPath, workspace), key: outputKey }
    }
  }
  const { errors, dependencies } = getDependencyGraph(result)
  if (errors.length > 0) {
    throw new Error(`Invalid configuration: ${errors.join('\n')}`)
  }
  result.workspaces = sortWorkspaces(result.workspaces, dependencies)
  return result
}

function sortWorkspaces(
  workspaces: Record<string, PlatformDetectionResult>,
  dependencies: Record<string, string[]>,
): Record<string, PlatformDetectionResult> {
  const sortedWorkspaces: string[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(workspace: string) {
    if (visiting.has(workspace)) {
      // TODO: move to validation errors
      throw new Error(`Circular dependency detected involving workspace: ${workspace}`)
    }
    if (visited.has(workspace)) {
      return
    }

    visiting.add(workspace)
    const deps = dependencies[workspace] || []
    for (const dep of deps) {
      visit(dep)
    }
    visiting.delete(workspace)
    visited.add(workspace)
    sortedWorkspaces.push(workspace)
  }

  for (const workspace of Object.keys(workspaces)) {
    visit(workspace)
  }
  const sortedWorkspacesObj: Record<string, PlatformDetectionResult> = {}
  for (const workspace of sortedWorkspaces) {
    // TODO: not sort object keys, change it to array
    sortedWorkspacesObj[workspace] = workspaces[workspace]
  }
  return sortedWorkspacesObj
}

async function readWorkspacesRecursively(
  config: PlatformConfig,
  rootPath: string,
): Promise<Record<string, PlatformDetectionResult>> {
  if (!config.workspace) {
    return {}
  }
  const workspaces: Record<string, PlatformDetectionResult> = {}

  const workspacePaths = await Promise.all(
    config.workspace.map((workspace) =>
      glob(workspace.endsWith('/') ? workspace : `${workspace}/`, {
        cwd: rootPath,
        absolute: true,
      }),
    ),
  )
  for (const workspacePath of workspacePaths) {
    for (const directory of workspacePath) {
      const workspaceConfig = await getPlatformConfiguration(directory)
      const c = workspaceConfig || {
        rootPath: directory,
        provider: '',
        workspaces: {},
        injections: {},
        output: {},
      }
      c.provider = c.provider || config.defaults?.provider || ''
      if (!c.provider) {
        throw new Error(`Workspace ${directory} has no provider`)
      }
      workspaces[directory] = c
    }
  }
  return workspaces
}

function getDependencyGraph(config: PlatformDetectionResult) {
  const errors: string[] = []
  const dependencies: Record<string, string[]> = {}
  // validate that all injections are valid
  for (const workspaceKey in config.workspaces) {
    const workspace = config.workspaces[workspaceKey]
    for (const injectionKey in workspace.injections) {
      const injection = workspace.injections[injectionKey]
      if (injection.workspace === null) {
        // meaning it should be part of input)
        continue
      }
      // TODO: maybe in the future we would need to check workspaces recursively, for now we just check the current level
      const dependency = config.workspaces[injection.workspace]
      if (!dependency) {
        errors.push(
          `Injection ${injectionKey} of workspace ${workspaceKey} references non-existent workspace ${injection.workspace}`,
        )
      }
      // TODO: we may need to check the outputs of other providers as well
      else if (dependency.provider === 'platform' && !dependency.output?.[injection.key]) {
        errors.push(
          `Injection ${injectionKey} of workspace ${workspaceKey} references non-existent output ${injection.key}`,
        )
      }
      // TODO: better detect circular dependencies
      else if (dependencies[injection.workspace]?.includes(workspaceKey)) {
        errors.push(`Circular dependency detected: ${injection.workspace} -> ${workspaceKey} -> ${injection.workspace}`)
      } else {
        dependencies[workspaceKey] = [...(dependencies[workspaceKey] || []), injection.workspace]
      }
    }
  }
  // validate that all outputs are valid

  return { errors, dependencies }
}
