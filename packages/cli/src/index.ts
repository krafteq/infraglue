#!/usr/bin/env node

import { Command, Help } from 'commander'
import { dirname, join, resolve } from 'path'
import { readFile } from 'fs/promises'
import {
  globalConfig,
  EnvManager,
  ExecutionContext,
  tryResolveMonorepo,
  MultistageExecutor,
  type Monorepo,
  type Workspace,
} from './core/index.js'
import { fileURLToPath } from 'url'
import { getFormatter } from './formatters/index.js'
import { getIntegration } from './integrations/index.js'
import { logger, UserError, IgError, isDebug, formatUnexpectedError, detectIntegration } from './utils/index.js'
import { generateBashCompletion, generateZshCompletion, generateFishCompletion } from './completions.js'
import pc from 'picocolors'

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
    if (command.opts().verbose || isDebug()) {
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

program
  .command('plan')
  .description('Preview infrastructure changes without applying')
  .option('-f, --format <format>', 'Select formatter for the plan', 'default')
  .option('-p, --project <project>', 'Project to plan')
  .option('-e, --env <env>', 'Environment to plan')
  .option('--no-deps', 'Ignore dependencies')
  .option('--detailed', 'Show attribute-level diffs for changed resources')
  .action(
    async ({
      format,
      env,
      project,
      deps,
      detailed,
    }: {
      format?: string
      env: string
      project?: string
      deps: boolean
      detailed?: boolean
    }) => {
      const monorepo = requireMonorepo()
      env = await resolveEnv(env)
      const execContext = new ExecutionContext(monorepo, currentWorkspace(project), !deps, false, env)
      const result = await new MultistageExecutor(execContext).plan({
        formatter: getFormatter(format),
        detailed: detailed ?? false,
      })
      process.exitCode = result.hasChanges ? 2 : 0
    },
  )

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
        integration: getIntegration(detectIntegration(integration)),
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
    logger.info(`Analyzing platform configuration in: ${currentDir}`)

    if (!monorepo) {
      if (options.json) {
        process.stdout.write(JSON.stringify({ monorepo: null }, null, 2) + '\n')
      } else {
        logger.info('No platform configuration found')
      }
      return
    }

    if (options.json) {
      const result = {
        monorepo: {
          root: monorepo.path,
          workspaces: monorepo.workspaces.map((ws) => ({
            name: ws.name,
            path: ws.path,
            provider: ws.providerName,
            dependencies: ws.allDependsOn,
          })),
          outputs: monorepo.exports,
          config: monorepo.configFile,
        },
      }
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } else {
      displayPlatformInfo(monorepo)
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

program
  .command('drift')
  .description('Detect infrastructure drift without modifying state')
  .option('-f, --format <format>', 'Select formatter for the plan', 'default')
  .option('-p, --project <project>', 'Project to check')
  .option('-e, --env <env>', 'Environment to check')
  .option('--no-deps', 'Ignore dependencies')
  .option('-j, --json', 'Output drift report as JSON')
  .addHelpText(
    'after',
    `
Examples:
  $ ig drift --env staging
  $ ig drift --env production --project postgres
  $ ig drift --env dev --json`,
  )
  .action(
    async ({
      format,
      env,
      project,
      deps,
      json,
    }: {
      format?: string
      env: string
      project?: string
      deps: boolean
      json?: boolean
    }) => {
      const monorepo = requireMonorepo()
      env = await resolveEnv(env)
      const execContext = new ExecutionContext(monorepo, currentWorkspace(project), !deps, false, env)
      const result = await new MultistageExecutor(execContext).drift({
        formatter: getFormatter(format),
        json: json ?? false,
      })
      if (json) {
        process.stdout.write(JSON.stringify(result.report, null, 2) + '\n')
      }
      process.exitCode = result.hasDrift ? 2 : 0
    },
  )

program
  .command('refresh')
  .description('Refresh infrastructure state from cloud providers')
  .option('-f, --format <format>', 'Select formatter for the plan', 'default')
  .option('-p, --project <project>', 'Project to refresh')
  .option('-e, --env <env>', 'Environment to refresh')
  .option('--no-deps', 'Ignore dependencies')
  .addHelpText(
    'after',
    `
Examples:
  $ ig refresh --env staging
  $ ig refresh --env production --project postgres`,
  )
  .action(async ({ env, project, deps }: { format?: string; env: string; project?: string; deps: boolean }) => {
    const monorepo = requireMonorepo()
    env = await resolveEnv(env)
    const execContext = new ExecutionContext(monorepo, currentWorkspace(project), !deps, false, env)
    await new MultistageExecutor(execContext).refreshState()
  })

program
  .command('import')
  .description('Import an existing cloud resource into infrastructure state')
  .argument('<args...>', 'Arguments to pass to the provider import command')
  .requiredOption('-p, --project <project>', 'Project to import into')
  .requiredOption('-e, --env <env>', 'Environment to use')
  .addHelpText(
    'after',
    `
Examples:
  $ ig import aws_instance.web i-1234567890abcdef0 --project webserver --env staging
  $ ig import 'aws:ec2/instance:Instance' web i-1234567890abcdef0 --project webserver --env staging`,
  )
  .action(async (args: string[], { env, project }: { env: string; project: string }) => {
    const monorepo = requireMonorepo()
    env = await resolveEnv(env)
    const ws = requireCurrentWorkspace(project)
    const execContext = new ExecutionContext(monorepo, ws, true, false, env)
    const inputs = await execContext.getInputs(ws)
    const stdout = await execContext.interop(ws).importResource(args, inputs)
    logger.info(stdout)
  })

program
  .command('export')
  .description('Generate code for imported or existing cloud resources')
  .argument('<args...>', 'Arguments to pass to the provider generate-code command')
  .requiredOption('-p, --project <project>', 'Project to generate code for')
  .requiredOption('-e, --env <env>', 'Environment to use')
  .addHelpText(
    'after',
    `
Examples:
  $ ig export aws_instance.web i-1234567890abcdef0 --project webserver --env staging
  $ ig export 'aws:ec2/instance:Instance' web i-1234567890abcdef0 --project webserver --env staging`,
  )
  .action(async (args: string[], { env, project }: { env: string; project: string }) => {
    const monorepo = requireMonorepo()
    env = await resolveEnv(env)
    const ws = requireCurrentWorkspace(project)
    const execContext = new ExecutionContext(monorepo, ws, true, false, env)
    const inputs = await execContext.getInputs(ws)
    const code = await execContext.interop(ws).generateCode(args, inputs)
    process.stdout.write(code)
  })

program
  .command('completion')
  .description('Output shell completion script')
  .argument('<shell>', 'Shell type: bash, zsh, or fish')
  .addHelpText(
    'after',
    `
Examples:
  $ ig completion bash >> ~/.bashrc
  $ ig completion zsh >> ~/.zshrc
  $ ig completion fish > ~/.config/fish/completions/ig.fish
  $ eval "$(ig completion bash)"`,
  )
  .action((shell: string) => {
    switch (shell) {
      case 'bash':
        process.stdout.write(generateBashCompletion() + '\n')
        break
      case 'zsh':
        process.stdout.write(generateZshCompletion() + '\n')
        break
      case 'fish':
        process.stdout.write(generateFishCompletion() + '\n')
        break
      default:
        throw new UserError(`Unknown shell '${shell}'. Supported: bash, zsh, fish.`)
    }
  })

// Enhanced help
for (const execCmd of execCommands) {
  const cmd = program.commands.find((c) => c.name() === execCmd.name)
  cmd?.addHelpText(
    'after',
    `
Examples:
  $ ig ${execCmd.name} --env staging
  $ ig ${execCmd.name} --env production --approve 1
  $ ig ${execCmd.name} --env dev --project postgres`,
  )
}

program.addHelpText(
  'after',
  `
Documentation: https://github.com/krafteq/infraglue
Report bugs:   https://github.com/krafteq/infraglue/issues`,
)

program.configureHelp({
  formatHelp: (cmd, helper) => {
    const defaultHelp = Help.prototype.formatHelp.call(helper, cmd, helper)
    if (process.stderr.isTTY) {
      return defaultHelp
        .replace(/^Usage:/m, pc.bold('Usage:'))
        .replace(/^Commands:/m, pc.bold('Commands:'))
        .replace(/^Options:/m, pc.bold('Options:'))
        .replace(/^Arguments:/m, pc.bold('Arguments:'))
    }
    return defaultHelp
  },
})

async function resolveEnv(env?: string | undefined): Promise<string> {
  if (env) {
    await new EnvManager(requireMonorepo()).selectEnv(env)
    return env
  } else {
    const currentEnv = await new EnvManager(requireMonorepo()).selectedEnv()
    if (!currentEnv) {
      throw new UserError("No environment selected. Run 'ig env select <env>' or pass --env <env>.")
    }
    return currentEnv
  }
}

function requireMonorepo(): Monorepo {
  if (monorepo === null) {
    throw new UserError(
      `Monorepo not found in ${currentDir}. Ensure there is an ig.yaml file with a 'workspace' field.`,
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
      `Single workspace is required. Run this command from a workspace directory or pass --project <name>.`,
    )
  }
  return ws
}

function displayPlatformInfo(monorepo: Monorepo) {
  logger.info(`\n${pc.bold('Platform Configuration Summary')}`)
  logger.info('=====================================')

  if (monorepo.workspaces.length > 0) {
    logger.info(`\n${pc.bold(`Workspaces (${monorepo.workspaces.length})`)}:`)
    monorepo.workspaces.forEach((workspace) => {
      logger.info(`  • ${pc.cyan(workspace.name)} ${pc.dim(`(${workspace.providerName})`)}`)
    })
  } else {
    logger.info('\nNo workspaces found')
  }

  if (monorepo.exports && monorepo.exports.length > 0) {
    logger.info(`\n${pc.bold(`Outputs (${monorepo.exports.length})`)}:`)
    monorepo.exports.forEach((exp) => {
      logger.info(`  • ${exp.name} ${pc.dim('←')} ${exp.workspace}:${exp.key}`)
    })
  }

  logger.debug('\nDetailed Information:')
  logger.debug(JSON.stringify(monorepo.configFile, null, 2))
}

// change current directory for local development
if (process.env['__DEV_CWD']) {
  logger.debug(`chdir ${process.env['__DEV_CWD']}`)
  process.chdir(process.env['__DEV_CWD'])
}

process.on('SIGINT', () => {
  process.exit(130)
})

process.on('uncaughtException', (err) => {
  handleError(err)
})

process.on('unhandledRejection', (err) => {
  if (err instanceof Error) {
    handleError(err)
  } else throw err
})

let packageVersion: string | undefined

function handleError(err: Error) {
  if (err instanceof IgError) {
    logger.error(pc.red(err.message))
    if (isDebug() && err.stack) {
      logger.error(pc.dim(err.stack))
    }
    process.exit(err.exitCode)
  }

  const version = packageVersion ?? 'unknown'
  logger.error(pc.red(formatUnexpectedError(err, version)))
  process.exit(1)
}

getPackageJsonVersion()
  .then((v) => {
    packageVersion = v
  })
  .catch(() => {})

program.parse()
