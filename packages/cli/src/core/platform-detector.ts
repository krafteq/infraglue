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
 * console.log('Execution order:', result.levels)
 */

import { readFile } from 'fs'
import { join } from 'path'
import { parse as parseYaml } from 'yaml'
import { promisify } from 'util'
import { glob } from 'glob'
import { sortWorkspacesByLevels } from '../utils/index.js'
import { providers as knownProviders } from '../providers/index.js'

const readFileAsync = promisify(readFile)

export interface EnvironmentConfig {
  // TODO: MB Environment config should be specific for each provider
  //  It seems like for pulumi we really need only backend_config, or rather Env Vars
  backend_file?: string // for terraform only.
  backend_type?: string // for terraform only.
  backend_config?: Record<string, string>
  var_files?: string[]
  vars?: Record<string, string>
}

export interface PlatformConfig {
  workspace?: string[]
  provider?: string
  injection?: Record<string, string>
  output?: Record<string, string>
  depends_on?: string[]
  envs?: Record<string, EnvironmentConfig>
  [key: string]: unknown
}

export interface PlatformInjection {
  workspace: string | null
  key: string
}

export interface PlatformDetectionResult {
  workspaces: Record<string, ProviderConfig>
  levels: ProviderConfig[][]
  variables: Record<string, string>
  output?: Record<string, PlatformInjection>
}

export interface ProviderConfig {
  rootPath: string
  provider: string
  injections: Record<string, PlatformInjection>
  depends_on?: string[]
  envs: Record<string, EnvironmentConfig> | undefined
}

const CONFIG_FILE_NAME = 'platform-config.yaml'
const DEFAULT_ENCODING = 'utf-8'

async function readConfigFile(fileName: string): Promise<PlatformConfig> {
  const content = await readFileAsync(fileName, DEFAULT_ENCODING)
  return parseYaml(content) as PlatformConfig
}

export async function getPlatformConfiguration(rootPath: string = process.cwd()): Promise<PlatformDetectionResult> {
  const fileName = join(rootPath, CONFIG_FILE_NAME)
  let config: PlatformConfig
  try {
    config = await readConfigFile(fileName)
  } catch (error) {
    throw new Error(`Error reading config file ${fileName}: ${error}`)
  }

  const workspaces = await readWorkspaces(config, rootPath)
  const result: PlatformDetectionResult = {
    workspaces,
    levels: [],
    variables: {},
    output: {},
  }
  result.variables = { ...config.injection }
  result.output = Object.fromEntries(
    Object.entries(config.output || {}).map(([key, value]) => {
      const [workspace, outputKey] = value.split(':')
      return [key, { workspace: join(rootPath, workspace), key: outputKey }]
    }),
  )
  const { errors, dependencies } = getDependencyGraph(result)
  if (errors.length > 0) {
    throw new Error(`Invalid configuration: ${errors.join('\n')}`)
  }
  result.levels = sortWorkspacesByLevels(result.workspaces, dependencies)
  return result
}

async function detectProvider(path: string): Promise<string | null> {
  for (const provider of knownProviders) {
    if (await provider.existsInFolder(path)) {
      return provider.getProviderName()
    }
  }
  return null
}

async function getWorkspaceConfiguration(path: string): Promise<ProviderConfig> {
  let config: PlatformConfig | null
  try {
    config = await readConfigFile(join(path, CONFIG_FILE_NAME))
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      config = null
    } else {
      throw new Error(`Error reading config file ${join(path, CONFIG_FILE_NAME)}: ${error}`)
    }
  }
  const provider = config?.provider || (await detectProvider(path))
  if (!provider) {
    throw new Error(`No provider found in ${path}`)
  }
  return {
    rootPath: path,
    provider,
    injections: Object.fromEntries(
      Object.entries(config?.injection || {}).map(([key, value]) => {
        const [workspace, injectionKey] = value.split(':')
        return [key, { workspace: join(path, workspace), key: injectionKey }]
      }),
    ),
    depends_on: (config?.depends_on || []).map((dependency) => join(path, dependency)),
    envs: config?.envs,
  }
}

async function readWorkspaces(rootConfig: PlatformConfig, rootPath: string): Promise<Record<string, ProviderConfig>> {
  if (!rootConfig.workspace) {
    return {}
  }

  const workspacePaths = await Promise.all(
    rootConfig.workspace.map((workspace) =>
      glob(workspace.endsWith('/') ? workspace : `${workspace}/`, {
        cwd: rootPath,
        absolute: true,
      }),
    ),
  )

  return Object.fromEntries(
    (await Promise.all(workspacePaths.flat().map(getWorkspaceConfiguration))).map((config, index) => [
      workspacePaths.flat()[index],
      { ...config, envs: config.envs || rootConfig.envs },
    ]),
  )
}

function getDependencyGraph(config: PlatformDetectionResult): {
  errors: string[]
  dependencies: Record<string, string[]>
} {
  const errors: string[] = []
  const dependencies: Record<string, string[]> = {}
  for (const workspaceKey in config.workspaces) {
    const workspace = config.workspaces[workspaceKey]
    for (const injectionKey in workspace.injections) {
      const injection = workspace.injections[injectionKey]
      if (injection.workspace === null) {
        // meaning it should be part of input)
        continue
      }
      const dependency = config.workspaces[injection.workspace]
      if (!dependency) {
        errors.push(
          `Injection ${injectionKey} of workspace ${workspaceKey} references non-existent workspace ${injection.workspace}`,
        )
      }
      // TODO: we may need to check the outputs of other providers as well
      else if (dependencies[injection.workspace]?.includes(workspaceKey)) {
        errors.push(`Circular dependency detected: ${injection.workspace} -> ${workspaceKey} -> ${injection.workspace}`)
      } else {
        ;(dependencies[workspaceKey] ||= []).push(injection.workspace)
      }
    }
    for (const depends_on of workspace.depends_on || []) {
      const dependency = config.workspaces[depends_on]
      if (!dependency) {
        errors.push(
          `Depends on ${depends_on} of workspace ${workspaceKey} references non-existent workspace ${depends_on}`,
        )
      }
      dependencies[workspaceKey] = [...(dependencies[workspaceKey] || []), depends_on]
    }
  }
  // validate that all outputs are valid

  return { errors, dependencies }
}
