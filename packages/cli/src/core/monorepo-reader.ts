import { Monorepo, Workspace } from './model.js'
import { readFile } from 'fs/promises'
import { dirname, join, relative, resolve } from 'path'
import { parse as parseYaml } from 'yaml'
import { glob } from 'node:fs/promises'
import type { MonorepoConfig, WorkspaceConfig } from './config-files.js'
import { globalConfig } from './global-config.js'
import { logger, UserError, ConfigError, interpolateConfig, loadDotEnvFiles } from '../utils/index.js'
import { VaultClient } from '../utils/vault-client.js'
import { getProvider, providers as knownProviders } from '../providers/index.js'
import type { EnvironmentConfig } from '../providers/index.js'
import { monorepoConfigSchema, workspaceConfigSchema, formatZodError } from './schemas.js'

const CONFIG_FILE_NAMES = ['ig.yaml', 'ig.yml']
const DEFAULT_ENCODING = 'utf-8'

export async function tryResolveMonorepo(startPath: string, envName?: string): Promise<Monorepo | null> {
  startPath = resolve(startPath)
  for (let current = resolve(startPath); current !== dirname(current); current = dirname(current)) {
    try {
      const monorepo = await tryReadMonorepo(current, envName)
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

export async function tryReadMonorepo(rootPath: string, envName?: string): Promise<Monorepo | null> {
  await loadDotEnvFiles(rootPath, envName)
  const raw = await readConfigFile(rootPath)
  if (raw && Array.isArray(raw.workspace) && raw.workspace.length > 0) {
    const parsed = monorepoConfigSchema.safeParse(raw)
    if (!parsed.success) {
      const configPath = CONFIG_FILE_NAMES.map((n) => join(rootPath, n)).join(' or ')
      throw new ConfigError(formatZodError(parsed.error), configPath)
    }
    const cfg = raw as MonorepoConfig
    const vaultAddress = cfg.vault?.address ?? process.env['VAULT_ADDR']
    const vaultClient = vaultAddress
      ? new VaultClient(vaultAddress, { role: cfg.vault?.role ?? process.env['VAULT_ROLE'] })
      : undefined
    const rootVars = await interpolateConfig(parsed.data.vars ?? {}, undefined, 'root ig.yaml vars', vaultClient)
    const workspaces = await readWorkspaces(cfg, rootPath, rootVars, vaultClient)

    const exports = Object.entries(cfg.output || {}).map(([key, value]) => {
      const [workspace, outputKey] = value.split(':')
      return { name: key, workspace: join(rootPath, workspace), key: outputKey }
    })

    return new Monorepo(rootPath, workspaces, exports, cfg, rootVars)
  }

  return null
}

async function readConfigFile(dirPath: string): Promise<Record<string, unknown> | null> {
  for (const candidate of CONFIG_FILE_NAMES) {
    try {
      const content = await readFile(join(dirPath, candidate), DEFAULT_ENCODING)
      return parseYaml(content) as Record<string, unknown> | null
    } catch (error) {
      if (!(error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
        throw new ConfigError(`Failed to parse YAML: ${error}`, join(dirPath, candidate))
      }
    }
  }
  return null
}

async function readWorkspaces(
  monorepoConfig: MonorepoConfig,
  rootPath: string,
  rootVars: Record<string, string>,
  vaultClient?: VaultClient,
): Promise<Workspace[]> {
  if (!monorepoConfig.workspace) {
    return []
  }

  const workspacePaths = await Promise.all(
    monorepoConfig.workspace.map(async (pattern) => {
      const globPattern = pattern.endsWith('/') ? pattern : `${pattern}/`
      const paths: string[] = []
      for await (const entry of glob(globPattern, { cwd: rootPath })) {
        const resolved = resolve(rootPath, entry)
        if (!resolved.startsWith(rootPath)) {
          logger.warn(`Workspace path ${entry} resolves outside monorepo root. Skipping.`)
          continue
        }
        paths.push(resolved)
      }
      return paths
    }),
  )

  return (
    await Promise.all(workspacePaths.flat().map((path) => getWorkspace(path, rootPath, rootVars, vaultClient)))
  ).filter((x) => !!x)
}

async function getWorkspace(
  path: string,
  rootPath: string,
  rootVars: Record<string, string>,
  vaultClient?: VaultClient,
): Promise<Workspace | null> {
  const raw = await readConfigFile(path)
  if (raw) {
    const parsed = workspaceConfigSchema.safeParse(raw)
    if (!parsed.success) {
      const configPath = CONFIG_FILE_NAMES.map((n) => join(path, n)).join(' or ')
      throw new ConfigError(formatZodError(parsed.error), configPath)
    }
  }
  const config = raw as WorkspaceConfig | null
  const provider = config?.provider || (await detectProvider(path))
  if (!provider) {
    if (globalConfig.strict) {
      throw new ConfigError('Cannot detect provider. Expected main.tf (Terraform) or Pulumi.yaml (Pulumi).', path)
    } else {
      logger.warn(`No provider found in ${path}. Skipping.`)
      return null
    }
  }

  const providerInstance = getProvider(provider)
  if (!providerInstance) {
    throw new UserError(`Unknown provider '${provider}' in ${path}. Supported: terraform, pulumi.`)
  }

  const injectionEntries = Object.entries(config?.injection || {}).map(([key, value]) => {
    const [workspace, injectionKey] = value.split(':')
    const resolvedPath = resolve(path, workspace)
    if (!resolvedPath.startsWith(rootPath)) {
      throw new ConfigError(`Injection '${key}' references path outside monorepo root: ${workspace}`, path)
    }
    return [key, { workspace: resolvedPath, key: injectionKey }] as const
  })

  const resolvedDeps = (config?.depends_on || []).map((dependency) => {
    const resolvedPath = resolve(path, dependency)
    if (!resolvedPath.startsWith(rootPath)) {
      throw new ConfigError(`depends_on references path outside monorepo root: ${dependency}`, path)
    }
    return resolvedPath
  })

  return new Workspace(
    config?.alias ?? relative(rootPath, path),
    path,
    rootPath,
    providerInstance,
    Object.fromEntries(injectionEntries),
    resolvedDeps,
    await interpolateEnvConfigs(config?.envs ?? {}, path, vaultClient),
    rootVars,
  )
}

async function interpolateEnvConfigs(
  envs: Record<string, EnvironmentConfig>,
  workspacePath: string,
  vaultClient?: VaultClient,
): Promise<Record<string, EnvironmentConfig>> {
  const result: Record<string, EnvironmentConfig> = {}
  for (const [envName, envConfig] of Object.entries(envs)) {
    const ctx = `workspace ${workspacePath} env '${envName}'`
    const interpolated: EnvironmentConfig = {}
    if (envConfig.backend_file !== undefined)
      interpolated.backend_file = await interpolateConfig(envConfig.backend_file, undefined, ctx, vaultClient)
    if (envConfig.backend_type !== undefined)
      interpolated.backend_type = await interpolateConfig(envConfig.backend_type, undefined, ctx, vaultClient)
    if (envConfig.backend_config !== undefined)
      interpolated.backend_config = await interpolateConfig(envConfig.backend_config, undefined, ctx, vaultClient)
    if (envConfig.vars !== undefined)
      interpolated.vars = await interpolateConfig(envConfig.vars, undefined, ctx, vaultClient)
    if (envConfig.var_files !== undefined)
      interpolated.var_files = await interpolateConfig(envConfig.var_files, undefined, ctx, vaultClient)
    result[envName] = interpolated
  }
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
