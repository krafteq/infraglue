#!/usr/bin/env node

import { Command } from 'commander'
import { dirname, join, resolve } from 'path'
import { readFile } from 'fs/promises'
import { globalConfig } from './core/index.js'
import { fileURLToPath } from 'url'
import { getFormatter } from './formatters/index.js'
import { getIntegration } from './integrations/index.js'
import { logger } from './utils/logger.js'
import { tryResolveMonorepo } from './core/monorepo-reader'
import { ExecutionContext, Monorepo, Workspace } from './core/model'
import { MultistageExecutor } from './core/multistage-executor'
import { UserError } from './utils/errors'
import { EnvManager } from './core/env-manager'

export async function getPackageJsonVersion(): Promise<string> {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  const packageJsonPath = join(__dirname, '../package.json')

  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'))
  return packageJson.version
}

const program = new Command()

let currentDir: string
let monorepo: Monorepo | null = null

program
  .name('ig')
  .option('-v, --verbose', 'Show verbose output')
  .option('-q, --quiet', 'Show quiet output')
  .option('--strict', 'Fail on most warnings')
  .option(
    '-d, --directory <directory>',
    'Root directory of infrastructure monorepo (defaults to current directory)',
    '.',
  )
  .description('CLI tool for infra-glue')
  .version(await getPackageJsonVersion())
  .hook('preAction', async (command) => {
    if (command.opts().verbose) {
      logger.setVerbose()
    }
    if (command.opts().quiet) {
      logger.setQuiet()
    }
    if (command.opts().strict) {
      globalConfig.strict = true
    }
    currentDir = resolve(command.opts().directory)
    monorepo = await tryResolveMonorepo(currentDir)
  })

const envCommand = program.command('env')
envCommand
  .command('select')
  .argument('env', 'Environment to select')
  .description('Select the environment to use')
  .action(async (env: string) => {
    await new EnvManager(requireMonorepo()).selectEnv(env)
  })

envCommand
  .command('current')
  .description('Show the current environment')
  .action(async () => {
    const selectedEnv = await new EnvManager(requireMonorepo()).selectedEnv()
    process.stdout.write(`${selectedEnv}\n`)
  })

interface IApplyOptions {
  format?: string
  integration?: string
  approve?: number
  env: string
  project?: string
}

const execCommands = [
  { name: 'apply', desc: 'Apply the platform configuration', isDestroy: false },
  { name: 'destroy', desc: 'Destroy the platform configuration', isDestroy: true },
]

for (const execCmd of execCommands) {
  program
    .command(execCmd.name)
    .description(execCmd.desc)
    .option('-f, --format <format>', 'Select formatter for the plan', 'default')
    .option('-i, --integration <integration>', 'Integration to use', 'cli')
    .option(
      '-a, --approve <level_index>',
      'Approve the plan for a specific level for non-interactive integration',
      (value) => {
        const parsedValue = parseInt(value, 10)
        if (isNaN(parsedValue)) {
          throw new Error('The level_index must be a number')
        }
        return parsedValue
      },
    )
    .option('-p, --project <project>', 'Project to apply')
    .option('-e, --env <env>', 'environment to apply. If provided, the environment will be selected before applying')
    .option('--no-deps', 'Ignore dependencies')
    .action(async ({ format, integration, approve, env, project, deps }: IApplyOptions & { deps: boolean }) => {
      const monorepo = requireMonorepo()
      env = await resolveEnv(env)

      const execContext = new ExecutionContext(monorepo, currentWorkspace(project), !deps, execCmd.isDestroy, env)

      await new MultistageExecutor(execContext).exec({
        approve: approve,
        integration: getIntegration(integration),
        formatter: getFormatter(format),
        preview: false,
      })
    })
}

const configCommand = program.command('config')

configCommand
  .command('init')
  .description('To be implemented. Initialize a new platform configuration for a directory')
  .action(async () => {
    logger.info(`Initializing platform configuration in: ${currentDir}`)
    logger.error('Not implemented yet')
  })

configCommand
  .command('show')
  .description('Parse and show platform configuration for a directory')
  .option('-j, --json', 'Output in JSON format')
  .action(async (options: { json?: boolean }) => {
    try {
      logger.info(`Analyzing platform configuration in: ${currentDir}`)

      if (!monorepo) {
        logger.info('No platform configuration found')
        return
      }

      if (options.json) {
        logger.info(JSON.stringify(monorepo.configFile, null, 2))
      } else {
        displayPlatformInfo(monorepo)
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

program
  .command('provider')
  .argument('[args...]', 'Arguments to pass to the provider')
  .action(async (args: string[]) => {
    const monorepo = requireMonorepo()
    const ws = requireCurrentWorkspace()
    const env = await resolveEnv()

    const executionCtx = new ExecutionContext(monorepo, ws, true, false, env)

    await executionCtx.interop(ws).execAnyCommand(args, () => executionCtx.getInputs(ws))
  })

async function resolveEnv(env?: string | undefined): Promise<string> {
  if (env) {
    await new EnvManager(requireMonorepo()).selectEnv(env)
    return env
  } else {
    const currentEnv = await new EnvManager(requireMonorepo()).selectedEnv()
    if (!currentEnv) {
      throw new UserError('No environment selected')
    }
    return currentEnv
  }
}

function requireMonorepo(): Monorepo {
  if (monorepo === null) {
    throw new UserError(
      `Monorepo not found. Ensure there is ig.yml file describing with 'workspace' field present in ${currentDir}`,
    )
  }
  return monorepo
}

function currentWorkspace(project?: string | undefined): Workspace | undefined {
  if (project) {
    return requireMonorepo().getWorkspace(project)
  }

  if (currentDir !== requireMonorepo().path) {
    return requireMonorepo().getWorkspace(currentDir)
  }

  return undefined
}

function requireCurrentWorkspace(project?: string | undefined): Workspace {
  const ws = currentWorkspace(project)
  if (!ws) {
    throw new UserError(
      `Single workspace is required. Either run a command from workspace directory or pass --project argument`,
    )
  }
  return ws
}

function displayPlatformInfo(monorepo: Monorepo) {
  logger.info('\n📋 Platform Configuration Summary')
  logger.info('=====================================')

  if (monorepo.workspaces.length > 0) {
    logger.info(`\n📁 Workspaces (${monorepo.workspaces.length}):`)
    monorepo.workspaces.forEach((workspace) => {
      logger.info(`  • ${workspace.name} (${workspace.providerName})`)
    })
  } else {
    logger.info('\n📁 No workspaces found')
  }

  if (monorepo.exports && monorepo.exports.length > 0) {
    logger.info(`\n📤 Outputs (${monorepo.exports.length}):`)
    monorepo.exports.forEach((exp) => {
      logger.info(`  • ${exp.name} ← ${exp.workspace}:${exp.key}`)
    })
  }

  logger.debug('\n🔍 Detailed Information:')
  logger.debug(JSON.stringify(monorepo.configFile, null, 2))
}

// change current directory for local development
if (process.env['__DEV_CWD']) {
  logger.debug(`chdir ${process.env['__DEV_CWD']}`)
  process.chdir(process.env['__DEV_CWD'])
}

process.on('uncaughtException', (err) => {
  handleError(err)
})

process.on('unhandledRejection', (err) => {
  if (err instanceof Error) {
    handleError(err)
  } else throw err
})

function handleError(err: Error) {
  if (err instanceof UserError) {
    logger.error(err.message)
    process.exit(2)
  }

  if (!logger.isVerbose()) {
    logger.error(err.message)
    process.exit(1)
  }

  throw err
}

program.parse()
