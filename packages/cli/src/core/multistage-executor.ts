import { type ExecutionContext, ExecutionPlanBuilder, Workspace } from './model.js'
import { StateManager } from './state-manager.js'
import { logger, UserError } from '../utils/index.js'
import {
  type ChangeSummary,
  hasChanges,
  type ProviderInput,
  type ProviderOutput,
  type ProviderPlan,
} from '../providers/index.js'
import type { IIntegration } from '../integrations/integration.js'
import type { IFormatter } from '../formatters/formatter.js'

export class MultistageExecutor {
  private readonly stateManager: StateManager

  public constructor(private readonly ctx: ExecutionContext) {
    this.stateManager = new StateManager(this.ctx.monorepo.path)
  }

  public async exec(opts: IExecOptions) {
    const state = await this.stateManager.read()
    if (!state.isEnvSelected) {
      throw new UserError(
        "Cannot execute: environments across workspaces are in inconsistent state. Run 'ig env select <env>' and try again.",
      )
    }

    if (state.env !== this.ctx.env) {
      throw new UserError(
        `Initialized environment '${state.env}' doesn't match execution environment '${this.ctx.env}'. Run 'ig env select ${this.ctx.env}' first.`,
      )
    }

    const executionPlan = new ExecutionPlanBuilder(this.ctx).build()
    logger.info(`\n Selected Environment: ${this.ctx.env}`)

    for (let levelIndex = 0; levelIndex < executionPlan.levelsCount; levelIndex++) {
      const level = executionPlan.levels[levelIndex]

      logger.info(`\n🔧 Processing Level ${levelIndex + 1}/${executionPlan.levelsCount}`)
      logger.info('=====================================')

      const levelPlans: Array<{
        workspace: Workspace
        inputs: ProviderInput
        plan: ProviderPlan
      }> = []

      for (const workspace of level.workspaces) {
        const inputs: ProviderInput = await this.ctx.getInputs(workspace)
        const interop = this.ctx.interop(workspace)

        let plan: ProviderPlan
        if (this.ctx.isDestroy) {
          const isDestroyed = await interop.isDestroyed()
          if (isDestroyed) {
            logger.info(`✅ ${workspace.name} is already destroyed.`)
            continue
          }

          plan = await interop.destroyPlan(inputs)
          if (!hasChanges(plan)) {
            logger.info(`✅ Nothing to destroy in ${workspace.name}`)
            continue
          }
        } else {
          plan = await interop.getPlan(inputs)
          if (!hasChanges(plan)) {
            const { outputs } = await interop.getOutputs({ stale: this.ctx.ignoreDependencies })
            logger.info(`✅ ${workspace.name} is up to date.`)

            // TODO: outputs can contain secrets, decide if we want to output them
            logger.debug(`Outputs: ${JSON.stringify(outputs, null, 2)}`)
            this.ctx.storeWorkspaceOutputs(workspace, outputs)
            continue
          }
        }

        levelPlans.push({ workspace, inputs, plan })
      }

      if (levelPlans.length === 0) {
        logger.info('✅ No changes needed in this level')
        continue
      }

      // TODO: it should probably be part of the formatter as well.
      logger.info('--------------------------------')
      logger.info(`📋 Level ${levelIndex + 1} Plan Summary:`)
      logger.info('--------------------------------')

      let totalChanges = zero()
      for (const { workspace, plan } of levelPlans) {
        logger.info(`\n🏭 Workspace: ${workspace.name}`)
        logger.info(`   ${dump(plan.changeSummary)}`)
        totalChanges = add(totalChanges, plan.changeSummary)
      }

      logger.info(`\n📊 Total Changes: ${dump(totalChanges)}`)

      let message = levelPlans
        .map(({ workspace, inputs, plan }) => {
          const formatted = opts.formatter.format(plan)
          return `🏭 Workspace: ${workspace.name}\nInputs:\n${JSON.stringify(inputs, null, 2)}\nPlan:\n${formatted}`
        })
        .join('\n--------------------------------\n')

      message += '\n--------------------------------\n'
      message += `Apply all workspaces in Level ${levelIndex + 1}?`

      if (!opts.integration.interactive && opts.approve === levelIndex + 1) {
        logger.info(`Level ${levelIndex + 1} approved, applying...`)
      } else {
        const answer = await opts.integration.askForConfirmation(message)

        if (!opts.integration.interactive) {
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
      await Promise.all(
        levelPlans.map(async ({ workspace, inputs }) => {
          const interop = this.ctx.interop(workspace)
          if (this.ctx.isDestroy) {
            logger.info(`   Destroying ${workspace.name}...`)
            await interop.destroy(inputs)
            this.ctx.storeDestroyedWorkspace(workspace)
            logger.info(`   ✅ ${workspace.name} destroyed successfully`)
          } else {
            logger.info(`   Applying ${workspace.name}...`)
            const outputs = await interop.apply(inputs)
            this.ctx.storeWorkspaceOutputs(workspace, outputs)
            logger.info(`   ✅ ${workspace.name} applied successfully`)
          }
          return workspace
        }),
      )

      logger.info(`✅ Level ${levelIndex + 1} completed`)
    }

    logger.info('\n--------------------------------')
    if (this.ctx.isDestroy) {
      logger.info('🎉 Infrastructure destroyed successfully')
    } else {
      logger.info('🎉 Infrastructure applied successfully')
      if (!this.ctx.currentWorkspace) {
        const result: ProviderOutput = {}
        for (const exp of this.ctx.monorepo.exports) {
          const valueToOutput = exp.workspace ? this.ctx.findAppliedOutput(exp.workspace, exp.key) : 'TODO?'
          if (valueToOutput === undefined) {
            logger.warn(`Value to output ${exp.key} from workspace ${exp.workspace} is not found`)
          } else {
            result[exp.name] = valueToOutput
          }
        }
        logger.info('Outputs:')
        logger.info(JSON.stringify(result, null, 2))
        logger.info('--------------------------------')
      }
    }
  }
}

function zero(): ChangeSummary {
  return {
    add: 0,
    change: 0,
    replace: 0,
    outputUpdates: 0,
    remove: 0,
  }
}

function dump(changes: ChangeSummary): string {
  return `Add: ${changes.add}, Change: ${changes.change}, Remove: ${changes.remove}, Replace: ${changes.replace}, Outputs: ${changes.outputUpdates}`
}

function add(changes1: ChangeSummary, changes2: ChangeSummary): ChangeSummary {
  return {
    add: changes1.add + changes2.add,
    change: changes1.change + changes2.change,
    replace: changes1.replace + changes2.replace,
    outputUpdates: changes1.outputUpdates + changes2.outputUpdates,
    remove: changes1.remove + changes2.remove,
  }
}

export interface IExecOptions {
  formatter: IFormatter
  integration: IIntegration
  approve?: number | undefined
  preview?: boolean
}
