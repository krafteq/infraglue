#!/usr/bin/env node

import { Command } from 'commander'
import { dirname, join, resolve } from 'path'
import { readFile } from 'fs'
import { promisify } from 'util'
import { getPlatformConfiguration, type PlatformDetectionResult, type ProviderConfig } from './core/index.js'
import { fileURLToPath } from 'url'
import {
  type ProviderOutput,
  type IProvider,
  type ProviderInput,
  type ProviderPlan,
  getProvider,
} from './providers/index.js'
import { getFormatter } from './formatters/index.js'
import { getIntegration } from './integrations/index.js'
import { logger } from './utils/logger.js'
import { readInternalState, writeInternalState } from './core/state-manager'

const readFileAsync = promisify(readFile)

export async function getPackageJsonVersion(): Promise<string> {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  const packageJsonPath = join(__dirname, '../package.json')

  const packageJson = JSON.parse(await readFileAsync(packageJsonPath, 'utf-8'))
  return packageJson.version
}

const program = new Command()

let resolvedPath: string // TODO: it shouldn't be global, should it?
program
  .name('ig')
  .option('-v, --verbose', 'Show verbose output')
  .option('-q, --quiet', 'Show quiet output')
  .option(
    '-d, --directory <directory>',
    'Root directory of infrastructure monorepo (defaults to current directory)',
    '.',
  )
  .description('CLI tool for infra-glue')
  .version(await getPackageJsonVersion())
  .hook('preAction', (command) => {
    if (command.opts().verbose) {
      logger.setVerbose()
    }
    if (command.opts().quiet) {
      logger.setQuiet()
    }
    resolvedPath = resolve(command.opts().directory)
  })

const selectEnv = async (env: string) => {
  logger.info(`Setting environment to ${env}`)

  const configuration = await getPlatformConfiguration(resolvedPath)
  if (!configuration) {
    logger.info('No platform configuration found')
    return
  }
  const promises: Promise<unknown>[] = []
  for (const level of configuration.levels) {
    for (const workspace of level) {
      const provider = getProvider(workspace.provider)
      if (!provider) {
        throw new Error(`Provider ${workspace.provider} not found`)
      }
      logger.info(`Selecting environment for ${workspace.alias}`)
      promises.push(provider.selectEnvironment(workspace, env))
    }
  }
  await Promise.all(promises)
  await writeInternalState(resolvedPath, { current_environment: env })
  logger.info('Environment selected successfully')
}

const resolveSelectedEnvironment = async (path: string, userSelectedEnv: string | null): Promise<string> => {
  const state = await readInternalState(path)
  const stateEnv = state?.current_environment
  if (userSelectedEnv) {
    if (userSelectedEnv !== stateEnv) {
      await selectEnv(userSelectedEnv)
      await writeInternalState(path, { current_environment: userSelectedEnv })
    }
    return userSelectedEnv
  } else if (stateEnv) {
    return stateEnv
  }
  throw new Error('No environment selected. Please select an environment or provide an environment with --env')
}

const envCommand = program.command('env')
envCommand
  .command('select')
  .argument('env', 'Environment to select')
  .description('Select the environment to use')
  .action(selectEnv)

envCommand
  .command('current')
  .description('Show the current environment')
  .action(async () => {
    const state = await readInternalState(resolvedPath)
    const stateEnv = state?.current_environment
    if (stateEnv) {
      process.stdout.write(`${stateEnv}\n`)
    } else {
      logger.error('No environment selected')
      process.exit(1)
    }
  })

program
  .command('apply')
  .description('Apply the platform configuration for a directory interactively')
  .option('-f, --format <format>', 'Format the plan', 'default')
  .option('-i, --integration <integration>', 'Integration to use', 'cli')
  .option('-a, --approve <level_index>', 'Approve the plan for a specific level', (value) => {
    const parsedValue = parseInt(value, 10)
    if (isNaN(parsedValue)) {
      throw new Error('The level_index must be a number')
    }
    return parsedValue
  })
  .option('-p, --project <project>', 'Project to apply')
  .option('-e, --env <env>', 'environment to apply. If provided, the environment will be selected before applying')
  .action(
    async ({
      format,
      integration,
      approve,
      env,
      project,
    }: {
      format?: string
      integration?: string
      approve?: number
      env: string
      project?: string
    }) => {
      logger.info(`Applying platform configuration in: ${resolvedPath}`)

      const configuration = await getPlatformConfiguration(resolvedPath)
      if (!configuration) {
        logger.info('No platform configuration found')
        return
      }
      const outputsCache: Map<string, ProviderOutput> = new Map()

      env = await resolveSelectedEnvironment(resolvedPath, env)

      let projectLevel: number | undefined = undefined
      if (project) {
        projectLevel = configuration.levels.findIndex((level) => level.find((workspace) => workspace.alias === project))
        if (projectLevel < 0) {
          throw new Error(`Project ${project} not found`)
        }
        logger.info(
          `Project ${project} found at level ${projectLevel + 1}. Applying everything until level ${projectLevel + 1}`,
        )
      }

      for (
        let levelIndex = 0;
        levelIndex < (projectLevel ? projectLevel + 1 : configuration.levels.length);
        levelIndex++
      ) {
        const level = configuration.levels[levelIndex]
        logger.info(`\n🔧 Processing Level ${levelIndex + 1}/${configuration.levels.length}`)
        logger.info('=====================================')

        // Collect all plans for this level
        const levelPlans: Array<{
          workspace: ProviderConfig
          provider: IProvider
          inputs: ProviderInput
          plan: ProviderPlan
        }> = []

        for (const workspace of level) {
          if (project && levelIndex === projectLevel && workspace.alias !== project) {
            logger.debug(`Skipping ${workspace.alias} as it's not selected project`)
            continue
          }

          const provider = getProvider(workspace.provider)
          if (!provider) {
            throw new Error(`Provider ${workspace.provider} not found`)
          }
          const inputs: ProviderInput = {}

          for (const injectionKey in workspace.injections) {
            const injection = workspace.injections[injectionKey]
            const valueToInject = injection.workspace
              ? outputsCache.get(injection.workspace)?.[injection.key]
              : undefined
            if (valueToInject === undefined) {
              throw new Error(`Value to inject ${injection.key} from workspace ${injection.workspace} is not found`)
            }
            inputs[injection.key] = valueToInject
          }

          const plan = await provider.getPlan(workspace, inputs, env)
          if (
            plan.resourceChanges.length === 0 ||
            !(
              plan.changeSummary.add > 0 ||
              plan.changeSummary.change > 0 ||
              plan.changeSummary.remove > 0 ||
              plan.changeSummary.replace > 0
            )
          ) {
            const outputs = await provider.getOutputs(workspace, env)
            logger.info(`✅ ${workspace.alias} is up to date. Outputs: ${JSON.stringify(outputs, null, 2)}`)
            outputsCache.set(workspace.rootPath, outputs)
            continue
          }

          levelPlans.push({ workspace, provider, inputs, plan })
        }

        // If no plans to apply in this level, continue to next level
        if (levelPlans.length === 0) {
          logger.info('✅ No changes needed in this level')
          continue
        }

        // TODO: it should probably be part of the formatter as well.
        logger.info('--------------------------------')
        logger.info(`📋 Level ${levelIndex + 1} Plan Summary:`)
        logger.info('--------------------------------')

        let totalAdd = 0
        let totalChange = 0
        let totalRemove = 0
        let totalReplace = 0

        for (const { workspace, plan } of levelPlans) {
          logger.info(`\n🏭 Workspace: ${workspace.alias}`)
          logger.info(
            `   Add: ${plan.changeSummary.add}, Change: ${plan.changeSummary.change}, Remove: ${plan.changeSummary.remove}, Replace: ${plan.changeSummary.replace}`,
          )
          totalAdd += plan.changeSummary.add
          totalChange += plan.changeSummary.change
          totalRemove += plan.changeSummary.remove
          totalReplace += plan.changeSummary.replace
        }

        logger.info(
          `\n📊 Total Changes: Add: ${totalAdd}, Change: ${totalChange}, Remove: ${totalRemove}, Replace: ${totalReplace}`,
        )

        let message = levelPlans
          .map(({ workspace, inputs, plan }) => {
            const formatter = getFormatter(format)
            const formatted = formatter.format(plan)
            return `🏭 Workspace: ${workspace.alias}\nInputs:\n${JSON.stringify(inputs, null, 2)}\nPlan:\n${formatted}`
          })
          .join('\n--------------------------------\n')

        message += '\n--------------------------------\n'
        message += `Apply all workspaces in Level ${levelIndex + 1}? (y/n)`

        const integrationInstance = getIntegration(integration)
        if (!integrationInstance.interactive && approve === levelIndex + 1) {
          logger.info(`Level ${levelIndex + 1} approved, applying...`)
        } else {
          const answer = await integrationInstance.askForConfirmation(message)

          if (!integrationInstance.interactive) {
            logger.info('Not interactive, waiting for confirmation and another cli execution')
            return
          }

          if (!answer) {
            logger.info('Aborting...')
            return
          }
        }

        // Apply all workspaces in this level
        logger.info(`\n🚀 Applying Level ${levelIndex + 1}...`)
        const applyPromises = levelPlans.map(async ({ workspace, provider, inputs }) => {
          logger.info(`   Applying ${workspace.alias}...`)
          const outputs = await provider.apply(workspace, inputs, env)
          outputsCache.set(workspace.rootPath, outputs)
          logger.info(`   ✅ ${workspace.alias} applied successfully`)
          return { workspace: workspace.rootPath, outputs }
        })

        await Promise.all(applyPromises)
        logger.info(`✅ Level ${levelIndex + 1} completed`)
      }

      logger.info('\n--------------------------------')
      logger.info('🎉 Infrastructure applied successfully')
      if (!project) {
        const result: ProviderOutput = {}
        for (const outputKey in configuration.output) {
          const output = configuration.output[outputKey]
          const valueToOutput = output.workspace ? outputsCache.get(output.workspace)?.[output.key] : 'TODO?'
          if (valueToOutput === undefined) {
            throw new Error(`Value to output ${output.key} from workspace ${output.workspace} is not found`)
          }
          result[outputKey] = valueToOutput
        }
        logger.info('Outputs:')
        logger.info(JSON.stringify(result, null, 2))
        logger.info('--------------------------------')
      }
    },
  )

program
  .command('destroy')
  .description('Destroy the platform configuration for a directory interactively')
  .option('-f, --format <format>', 'Format the plan', 'default')
  .option('-i, --integration <integration>', 'Integration to use', 'cli')
  .option('-a, --approve <level_index>', 'Approve the plan for a specific level', (value) => {
    const parsedValue = parseInt(value, 10)
    if (isNaN(parsedValue)) {
      throw new Error('The level_index must be a number')
    }
    return parsedValue
  })
  .option('-p, --project <project>', 'Project to destroy')
  .option('-e, --env <env>', 'environment to apply. If provided, the environment will be selected before applying')
  .action(
    async ({
      format,
      integration,
      approve,
      env,
      project,
    }: {
      format?: string
      integration?: string
      approve?: number
      env: string
      project?: string
    }) => {
      logger.info(`Destroying platform configuration in: ${resolvedPath}`)

      const configuration = await getPlatformConfiguration(resolvedPath)
      if (!configuration) {
        logger.info('No platform configuration found')
        return
      }

      env = await resolveSelectedEnvironment(resolvedPath, env)

      // First, collect all outputs from existing infrastructure
      const outputsCache: Map<string, ProviderOutput> = new Map()
      logger.info('\n📊 Collecting existing infrastructure outputs...')
      for (const level of configuration.levels) {
        for (const workspace of level) {
          const provider = getProvider(workspace.provider)
          if (!provider) {
            throw new Error(`Provider ${workspace.provider} not found`)
          }
          try {
            const outputs = await provider.getOutputs(workspace, env)
            outputsCache.set(workspace.rootPath, outputs)
          } catch (error) {
            logger.warn(`❌ couldn't load outputs for ${workspace.alias}: ${error}`)
          }
        }
      }

      let projectLevel: number | undefined = undefined
      if (project) {
        projectLevel = configuration.levels.findIndex((level) => level.find((workspace) => workspace.alias === project))
        if (projectLevel < 0) {
          throw new Error(`Project ${project} not found`)
        }
        logger.info(
          `Project ${project} found at level ${projectLevel + 1}. Destroying everything above level ${projectLevel + 1}`,
        )
      }

      for (let levelIndex = configuration.levels.length - 1; levelIndex >= (projectLevel || 0); levelIndex--) {
        const level = configuration.levels[levelIndex]
        logger.info(`\n🗑️  Processing Level ${levelIndex + 1}/${configuration.levels.length} for destruction`)
        logger.info('=====================================')

        // Collect all destroy plans for this level
        const levelDestroyPlans: Array<{
          workspace: ProviderConfig
          provider: IProvider
          inputs: ProviderInput
          plan: ProviderPlan
        }> = []

        for (const workspace of level) {
          if (project && levelIndex === projectLevel && workspace.alias !== project) {
            logger.debug(`Skipping ${workspace.alias} as it's not selected project`)
            continue
          }

          const provider = getProvider(workspace.provider)
          if (!provider) {
            throw new Error(`Provider ${workspace.provider} not found`)
          }
          const isDestroyed = await provider.isDestroyed(workspace, env)
          if (isDestroyed) {
            logger.info(`✅ ${workspace.alias} is already destroyed.`)
            continue
          }

          const inputs: ProviderInput = {}
          for (const injectionKey in workspace.injections) {
            const injection = workspace.injections[injectionKey]
            const valueToInject = injection.workspace
              ? outputsCache.get(injection.workspace)?.[injection.key]
              : undefined
            if (valueToInject === undefined) {
              throw new Error(`Value to inject ${injection.key} from workspace ${injection.workspace} is not found`)
            }
            inputs[injection.key] = valueToInject
          }

          const plan = await provider.destroyPlan(workspace, inputs, env)
          if (
            plan.resourceChanges.length === 0 ||
            !(
              plan.changeSummary.add > 0 ||
              plan.changeSummary.change > 0 ||
              plan.changeSummary.remove > 0 ||
              plan.changeSummary.replace > 0
            )
          ) {
            logger.info(`✅ Nothing to destroy in ${workspace.alias}`)
            continue
          }

          levelDestroyPlans.push({ workspace, provider, inputs, plan })
        }

        // If no plans to destroy in this level, continue to next level
        if (levelDestroyPlans.length === 0) {
          logger.info('✅ No resources to destroy in this level')
          continue
        }

        // Show combined destroy plan for the level
        logger.info('--------------------------------')
        logger.info(`📋 Level ${levelIndex + 1} Destroy Plan Summary:`)
        logger.info('--------------------------------')

        let totalAdd = 0
        let totalChange = 0
        let totalRemove = 0
        let totalReplace = 0

        for (const { workspace, plan } of levelDestroyPlans) {
          logger.info(`\n🏭 Workspace: ${workspace.alias}`)
          logger.info(
            `   Add: ${plan.changeSummary.add}, Change: ${plan.changeSummary.change}, Remove: ${plan.changeSummary.remove}, Replace: ${plan.changeSummary.replace}`,
          )
          totalAdd += plan.changeSummary.add
          totalChange += plan.changeSummary.change
          totalRemove += plan.changeSummary.remove
          totalReplace += plan.changeSummary.replace
        }

        logger.info(
          `\n📊 Total Changes: Add: ${totalAdd}, Change: ${totalChange}, Remove: ${totalRemove}, Replace: ${totalReplace}`,
        )

        const formatter = getFormatter(format)
        let message = levelDestroyPlans
          .map(({ workspace, plan }) => {
            const formatted = formatter.format(plan)
            return `🏭 Workspace: ${workspace.alias}\nDestroy Plan:\n${formatted}`
          })
          .join('\n--------------------------------\n')

        message += '\n--------------------------------\n'
        message += `🗑️  Destroy all workspaces in Level ${levelIndex + 1}? (y/n)`

        const integrationInstance = getIntegration(integration)
        if (!integrationInstance.interactive && approve === levelIndex + 1) {
          logger.info(`Level ${levelIndex + 1} approved, destroying...`)
        } else {
          const answer = await integrationInstance.askForConfirmation(message)

          if (!integrationInstance.interactive) {
            logger.info('Not interactive, waiting for confirmation and another cli execution')
            return
          }

          if (!answer) {
            logger.info('Aborting...')
            return
          }
        }

        // Destroy all workspaces in this level
        logger.info(`\n💥 Destroying Level ${levelIndex + 1}...`)
        const destroyPromises = levelDestroyPlans.map(async ({ workspace, provider, inputs }) => {
          logger.info(`   Destroying ${workspace.alias}...`)
          await provider.destroy(workspace, inputs, env)
          logger.info(`   ✅ ${workspace.alias} destroyed successfully`)
          return { workspace: workspace.rootPath }
        })

        await Promise.all(destroyPromises)
        logger.info(`✅ Level ${levelIndex + 1} destroyed`)
      }

      logger.info('\n--------------------------------')
      logger.info('🎉 Infrastructure destroyed successfully')
    },
  )

const configCommand = program.command('config')

configCommand
  .command('init')
  .description('To be implemented. Initialize a new platform configuration for a directory')
  .action(async () => {
    logger.info(`Initializing platform configuration in: ${resolvedPath}`)
    logger.error('Not implemented yet')
  })

configCommand
  .command('show')
  .description('Parse and show platform configuration for a directory')
  .option('-j, --json', 'Output in JSON format')
  .action(async (options: { json?: boolean }) => {
    try {
      logger.info(`Analyzing platform configuration in: ${resolvedPath}`)

      const result = await getPlatformConfiguration(resolvedPath)
      if (!result) {
        logger.info('No platform configuration found')
        return
      }

      if (options.json) {
        logger.info(JSON.stringify(result, null, 2))
      } else {
        displayPlatformInfo(result)
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

function displayPlatformInfo(result: PlatformDetectionResult) {
  logger.info('\n📋 Platform Configuration Summary')
  logger.info('=====================================')

  if (Object.keys(result.workspaces).length > 0) {
    logger.info(`\n📁 Workspaces (${Object.keys(result.workspaces).length}):`)
    Object.entries(result.workspaces).forEach(([name, workspace]) => {
      logger.info(`  • ${name} (${workspace.provider})`)
    })
  } else {
    logger.info('\n📁 No workspaces found')
  }

  if (result.output && Object.keys(result.output).length > 0) {
    logger.info(`\n📤 Outputs (${Object.keys(result.output).length}):`)
    Object.entries(result.output).forEach(([key, output]) => {
      logger.info(`  • ${key} ← ${output.workspace}:${output.key}`)
    })
  }

  logger.debug('\n🔍 Detailed Information:')
  logger.debug(JSON.stringify(result, null, 2))
}

program.parse()
