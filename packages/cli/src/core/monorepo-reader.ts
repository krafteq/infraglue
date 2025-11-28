import { Monorepo, Workspace } from './model.js'
import { readFile } from 'fs/promises'
import { dirname, join, relative, resolve } from 'path'
import { parse as parseYaml } from 'yaml'
import { glob } from 'glob'
import type { MonorepoConfig, WorkspaceConfig } from './config-files.js'
import { globalConfig } from './global-config.js'
import { logger, UserError } from '../utils/index.js'
import { getProvider, providers as knownProviders } from '../providers/index.js'

const CONFIG_FILE_NAMES = ['ig.yaml', 'ig.yml']
const DEFAULT_ENCODING = 'utf-8'

export async function tryResolveMonorepo(startPath: string): Promise<Monorepo | null> {
  startPath = resolve(startPath)
  for (let current = resolve(startPath); current !== dirname(current); current = dirname(current)) {
    try {
      const monorepo = await tryReadMonorepo(current)
      if (monorepo && (monorepo.path === startPath || monorepo.workspaces.find((x) => x.path === startPath))) {
        return monorepo
      }
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          (error.message.includes('No config file found in') || error.message.includes('No workspaces found in'))
        )
      ) {
        throw error
      }
    }
  }
  return null
}

export async function tryReadMonorepo(rootPath: string): Promise<Monorepo | null> {
  const cfg = await readConfigFile<MonorepoConfig>(rootPath)
  if (cfg && cfg.workspace && cfg.workspace.length > 0) {
    const workspaces = await readWorkspaces(cfg, rootPath)

    const exports = Object.entries(cfg.output || {}).map(([key, value]) => {
      const [workspace, outputKey] = value.split(':')
      return { name: key, workspace: join(rootPath, workspace), key: outputKey }
    })

    return new Monorepo(rootPath, workspaces, exports, cfg)
  }

  return null
}

async function readConfigFile<T>(dirPath: string): Promise<T | null> {
  for (const candidate of CONFIG_FILE_NAMES) {
    try {
      const content = await readFile(join(dirPath, candidate), DEFAULT_ENCODING)
      return parseYaml(content) as T
    } catch (error) {
      if (!(error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
        throw new Error(`Error reading config file ${join(dirPath, candidate)}: ${error}`)
      }
    }
  }
  return null
}

async function readWorkspaces(monorepoConfig: MonorepoConfig, rootPath: string): Promise<Workspace[]> {
  if (!monorepoConfig.workspace) {
    return []
  }

  const workspacePaths = await Promise.all(
    monorepoConfig.workspace.map(async (workspace) => {
      const paths = await glob(workspace.endsWith('/') ? workspace : `${workspace}/`, {
        cwd: rootPath,
        absolute: true,
      })
      return paths
    }),
  )

  return (await Promise.all(workspacePaths.flat().map((path) => getWorkspace(path, rootPath)))).filter((x) => !!x)
}

async function getWorkspace(path: string, rootPath: string): Promise<Workspace | null> {
  const config = await readConfigFile<WorkspaceConfig>(path)
  const provider = config?.provider || (await detectProvider(path))
  if (!provider) {
    if (globalConfig.strict) {
      throw new Error(`No provider found in ${path}`)
    } else {
      logger.warn(`No provider found in ${path}. Skipping.`)
      return null
    }
  }

  const providerInstance = getProvider(provider)
  if (!providerInstance) {
    throw new UserError(`Unknown provider ${provider}`)
  }

  return new Workspace(
    config?.alias ?? relative(rootPath, path),
    path,
    rootPath,
    providerInstance,
    Object.fromEntries(
      Object.entries(config?.injection || {}).map(([key, value]) => {
        const [workspace, injectionKey] = value.split(':')
        return [key, { workspace: join(path, workspace), key: injectionKey }]
      }),
    ),
    (config?.depends_on || []).map((dependency) => join(path, dependency)),
    config?.envs ?? {},
  )
}

async function detectProvider(path: string): Promise<string | null> {
  for (const provider of knownProviders) {
    if (await provider.existsInFolder(path)) {
      return provider.getProviderName()
    }
  }
  return null
}
