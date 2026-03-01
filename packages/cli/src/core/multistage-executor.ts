import { type ExecutionContext, type ExecutionPlan, ExecutionPlanBuilder, Workspace } from './model.js'
import { StateManager } from './state-manager.js'
import { logger, UserError } from '../utils/index.js'
import {
  type ChangeSummary,
  hasChanges,
  type Output,
  type ProviderEvent,
  type ProviderInput,
  type ProviderOutput,
  type ProviderPlan,
} from '../providers/index.js'
import type { IIntegration } from '../integrations/integration.js'
import type { IFormatter } from '../formatters/formatter.js'
import { computeDetailedDiff } from './plan-diff.js'
import {
  WorkspaceApplyState,
  WorkspacePlanState,
  LiveRenderer,
  NonTtyRenderer,
  PlanLiveRenderer,
  PlanNonTtyRenderer,
  type ILiveRenderer,
  type IPlanRenderer,
} from '../rendering/index.js'

interface LevelPlanEntry {
  workspace: Workspace
  inputs: ProviderInput
  plan: ProviderPlan
}

export class MultistageExecutor {
  private readonly stateManager: StateManager

  public constructor(private readonly ctx: ExecutionContext) {
    this.stateManager = new StateManager(this.ctx.monorepo.path)
  }

  private async validateEnv() {
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
  }

  private async resolveStartLevel(executionPlan: ExecutionPlan): Promise<number> {
    const target = this.ctx.startWithWorkspace
    if (!target) return 0

    let targetLevelIndex = -1
    for (let i = 0; i < executionPlan.levelsCount; i++) {
      if (executionPlan.levels[i].workspaces.some((ws) => ws.name === target.name)) {
        targetLevelIndex = i
        break
      }
    }

    if (targetLevelIndex === -1) {
      throw new UserError(
        `Workspace '${target.name}' not found in the execution plan. ` +
          `It may not have the selected environment or may be filtered out by --project.`,
      )
    }

    if (targetLevelIndex === 0) return 0

    // Validate that all skipped workspaces have cached outputs in state
    const state = await this.stateManager.read()
    const missingOutputs: string[] = []

    for (let i = 0; i < targetLevelIndex; i++) {
      for (const ws of executionPlan.levels[i].workspaces) {
        const cachedOutputs = state.workspace(ws.name).outputs
        if (!cachedOutputs) {
          missingOutputs.push(ws.name)
        }
      }
    }

    if (missingOutputs.length > 0) {
      throw new UserError(
        `Cannot skip to '${target.name}': missing cached outputs for skipped workspaces: ${missingOutputs.join(', ')}. ` +
          `Run a full 'ig apply' first to populate the cache.`,
      )
    }

    // Pre-populate workspaceOutputs from cached state for skipped levels
    for (let i = 0; i < targetLevelIndex; i++) {
      for (const ws of executionPlan.levels[i].workspaces) {
        const cachedOutputs = state.workspace(ws.name).outputs!
        this.ctx.storeWorkspaceOutputs(ws, cachedOutputs)
        logger.info(`⏭️  Skipping ${ws.name} (using cached outputs)`)
      }
    }

    return targetLevelIndex
  }

  private async gatherLevelPlans(
    workspaces: Workspace[],
    options?: { detailed?: boolean; savePlanFile?: boolean },
  ): Promise<LevelPlanEntry[]> {
    if (workspaces.length <= 1) {
      return this.gatherLevelPlansSequential(workspaces, options)
    }
    return this.gatherLevelPlansParallel(workspaces, options)
  }

  private async gatherLevelPlansSequential(
    workspaces: Workspace[],
    options?: { detailed?: boolean; savePlanFile?: boolean },
  ): Promise<LevelPlanEntry[]> {
    const levelPlans: LevelPlanEntry[] = []

    for (const workspace of workspaces) {
      const entry = await this.planSingleWorkspace(workspace, null, options)
      if (entry) levelPlans.push(entry)
    }

    return levelPlans
  }

  private async gatherLevelPlansParallel(
    workspaces: Workspace[],
    options?: { detailed?: boolean; savePlanFile?: boolean },
  ): Promise<LevelPlanEntry[]> {
    const isTTY = process.stderr.isTTY ?? false
    const renderer: IPlanRenderer = isTTY ? new PlanLiveRenderer() : new PlanNonTtyRenderer()

    const planStates = workspaces.map((ws) => {
      const state = new WorkspacePlanState(ws.name)
      renderer.addWorkspace(state)
      return state
    })

    renderer.start()

    const nonTtyRenderer = !isTTY ? (renderer as PlanNonTtyRenderer) : null

    const results = await Promise.allSettled(
      workspaces.map(async (ws, i) => {
        nonTtyRenderer?.writeStatusChange(ws.name, 'planning...')
        try {
          const entry = await this.planSingleWorkspace(ws, planStates[i], options)
          const st = planStates[i]
          if (st.status === 'done' && st.changeSummary) {
            const cs = st.changeSummary
            nonTtyRenderer?.writeStatusChange(ws.name, `+${cs.add} ~${cs.change} -${cs.remove} (${st.elapsedSeconds}s)`)
          } else if (st.status === 'up-to-date') {
            nonTtyRenderer?.writeStatusChange(ws.name, `up to date (${st.elapsedSeconds}s)`)
          }
          return entry
        } catch (error) {
          nonTtyRenderer?.writeStatusChange(ws.name, `failed (${planStates[i].elapsedSeconds}s)`)
          throw error
        }
      }),
    )

    renderer.stop()

    const levelPlans: LevelPlanEntry[] = []
    const failures: { workspace: string; error: string }[] = []

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === 'fulfilled' && result.value) {
        levelPlans.push(result.value)
      } else if (result.status === 'rejected') {
        failures.push({
          workspace: workspaces[i].name,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
      }
    }

    if (failures.length > 0) {
      for (const f of failures) {
        logger.error(`   Failed to plan ${f.workspace}:\n${f.error}`)
      }
      throw new UserError(`Failed to plan workspaces: ${failures.map((f) => f.workspace).join(', ')}`)
    }

    return levelPlans
  }

  private async planSingleWorkspace(
    workspace: Workspace,
    state: WorkspacePlanState | null,
    options?: { detailed?: boolean; savePlanFile?: boolean },
  ): Promise<LevelPlanEntry | null> {
    const interop = this.ctx.interop(workspace)

    state?.markPlanning()

    try {
      if (this.ctx.isDestroy) {
        const isDestroyed = await interop.isDestroyed()
        if (isDestroyed) {
          if (!state) logger.info(`✅ ${workspace.name} is already destroyed.`)
          state?.markUpToDate()
          return null
        }

        const inputs: ProviderInput = await this.ctx.getInputs(workspace, { bestEffort: true })
        const plan = await interop.destroyPlan(inputs, options?.savePlanFile ? { savePlanFile: true } : undefined)

        if (!hasChanges(plan)) {
          if (!state) logger.info(`✅ Nothing to destroy in ${workspace.name}`)
          state?.markUpToDate()
          return null
        }

        state?.markDone(plan.changeSummary)
        return { workspace, inputs, plan }
      } else {
        const inputs: ProviderInput = await this.ctx.getInputs(workspace)
        const plan = await interop.getPlan(inputs, options)

        if (!hasChanges(plan)) {
          const { outputs } = await interop.getOutputs({ stale: this.ctx.ignoreDependencies })

          if (hasOutputDiff(plan.outputs, outputs)) {
            if (!state) logger.info(`📤 ${workspace.name} has output-only changes`)
            state?.markDone(plan.changeSummary)
            return { workspace, inputs, plan }
          }

          if (!state) logger.info(`✅ ${workspace.name} is up to date.`)
          logger.debug(`Outputs: ${JSON.stringify(outputs, null, 2)}`)
          this.ctx.storeWorkspaceOutputs(workspace, outputs)
          state?.markUpToDate()
          return null
        }

        state?.markDone(plan.changeSummary)
        return { workspace, inputs, plan }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      state?.markFailed(msg)
      throw error
    }
  }

  private logPlanSummary(
    levelIndex: number,
    levelPlans: LevelPlanEntry[],
    formatter: IFormatter,
    options?: { skipFormattedPlan?: boolean },
  ) {
    let totalChanges = zero()
    for (const { plan } of levelPlans) {
      totalChanges = add(totalChanges, plan.changeSummary)
    }

    const maxNameLen = Math.max(...levelPlans.map(({ workspace }) => workspace.name.length))
    logger.info(`📋 Level ${levelIndex + 1} Plan Summary: ${dump(totalChanges)}`)
    for (const { workspace, plan } of levelPlans) {
      logger.info(`   ${workspace.name.padEnd(maxNameLen)}  ${dump(plan.changeSummary)}`)
    }

    if (!options?.skipFormattedPlan) {
      for (const { workspace, plan } of levelPlans) {
        const formatted = formatter.format(plan)
        logger.info(`\n${workspace.name}:\n${formatted}`)
      }
    }
  }

  private handleLevelFailures(results: PromiseSettledResult<Workspace>[], workspaces: Workspace[]): void {
    const failures = results
      .map((r, i) => ({ result: r, workspace: workspaces[i] }))
      .filter((x): x is { result: PromiseRejectedResult; workspace: Workspace } => x.result.status === 'rejected')

    if (failures.length > 0) {
      const failedNames = failures.map((f) => f.workspace.name)
      const action = this.ctx.isDestroy ? 'destroy' : 'apply'
      for (const { workspace, result } of failures) {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
        logger.error(`   Failed to ${action} ${workspace.name}:\n${reason}`)
      }
      throw new UserError(
        `Failed to ${action} workspaces: ${failedNames.join(', ')}. ` +
          `If provider state is locked, run 'ig provider force-unlock <lock-id>' in each failed workspace.`,
      )
    }
  }

  public async plan(opts: IPlanExecOptions): Promise<PlanResult> {
    await this.validateEnv()

    const executionPlan = new ExecutionPlanBuilder(this.ctx).build()
    const startIndex = await this.resolveStartLevel(executionPlan)
    logger.info(`\n Selected Environment: ${this.ctx.env}`)

    let hasAnyChanges = false

    for (let levelIndex = startIndex; levelIndex < executionPlan.levelsCount; levelIndex++) {
      const level = executionPlan.levels[levelIndex]

      logger.info(`\n🔧 Processing Level ${levelIndex + 1}/${executionPlan.levelsCount}`)
      logger.info('=====================================')

      const levelPlans = await this.gatherLevelPlans(level.workspaces, opts.detailed ? { detailed: true } : undefined)

      if (levelPlans.length === 0) {
        logger.info('✅ No changes needed in this level')
        continue
      }

      hasAnyChanges = true
      this.logPlanSummary(
        levelIndex,
        levelPlans,
        opts.formatter,
        opts.detailed ? { skipFormattedPlan: true } : undefined,
      )

      if (opts.detailed) {
        for (const { workspace, plan } of levelPlans) {
          const diff = computeDetailedDiff(plan.resourceChanges)
          logger.info(
            `\n🔍 ${workspace.name}: ${diff.metadataOnlyCount} metadata-only, ${diff.realChangeCount} real changes`,
          )

          if (diff.metadataOnlyCount > 0) {
            logger.info(`\n   metadata-only (${diff.metadataOnlyCount}):`)
            for (const resource of diff.resources) {
              if (resource.isMetadataOnly) {
                logger.info(`      ${resource.address}`)
              }
            }
          }

          if (diff.realChangeCount > 0) {
            logger.info(`\n   real changes (${diff.realChangeCount}):`)
            for (const resource of diff.resources) {
              if (!resource.isMetadataOnly && resource.attributeDiffs.length > 0) {
                logger.info(`      ${resource.address}`)
                for (const attr of resource.attributeDiffs) {
                  logger.info(`         ${attr.key}: ${JSON.stringify(attr.before)} → ${JSON.stringify(attr.after)}`)
                }
              } else if (!resource.isMetadataOnly) {
                logger.info(`      ${resource.address} [${resource.actions.join(', ')}]`)
              }
            }
          } else {
            logger.info(`\n   real changes (0): (none)`)
          }
        }
      }
    }

    return { hasChanges: hasAnyChanges }
  }

  private async applyWorkspaces(
    entries: Array<{ workspace: Workspace; inputs: ProviderInput; planFile?: string }>,
    levelIndex: number,
  ): Promise<WorkspaceApplyState[]> {
    const action = this.ctx.isDestroy ? 'Destroying' : 'Applying'
    logger.info(`\n🚀 ${action} Level ${levelIndex + 1}...`)

    const isTTY = process.stderr.isTTY ?? false
    const renderer: ILiveRenderer = isTTY ? new LiveRenderer({ verbose: logger.isVerbose() }) : new NonTtyRenderer()

    const wsStates = entries.map(({ workspace }) => {
      const wsState = new WorkspaceApplyState(workspace.name)
      renderer.addWorkspace(wsState)
      return wsState
    })

    renderer.start()

    const onSigint = () => {
      renderer.stop()
    }
    process.on('SIGINT', onSigint)

    const results = await Promise.allSettled(
      entries.map(async ({ workspace, inputs, planFile }, i) => {
        const interop = this.ctx.interop(workspace)
        const wsState = wsStates[i]

        const onEvent = (event: ProviderEvent) => {
          wsState.handleEvent(event)
          if (!isTTY) (renderer as NonTtyRenderer).writeEvent(workspace.name, event)
        }

        const applyOpts = planFile ? { onEvent, planFile } : { onEvent }

        if (this.ctx.isDestroy) {
          try {
            await interop.destroy(inputs, applyOpts)
            wsState.markComplete()
            this.ctx.storeDestroyedWorkspace(workspace)
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            wsState.markFailed(msg)
            throw error
          }
        } else {
          try {
            const outputs = await interop.apply(inputs, applyOpts)
            wsState.markComplete()
            this.ctx.storeWorkspaceOutputs(workspace, outputs)
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            wsState.markFailed(msg)
            throw error
          }
        }
        return workspace
      }),
    )

    process.removeListener('SIGINT', onSigint)
    renderer.stop()

    this.handleLevelFailures(
      results,
      entries.map((e) => e.workspace),
    )

    return wsStates
  }

  private async applyLevelDirectly(workspaces: Workspace[], levelIndex: number): Promise<WorkspaceApplyState[]> {
    logger.info(`Level ${levelIndex + 1} pre-approved, applying directly...`)

    const entries: Array<{ workspace: Workspace; inputs: ProviderInput }> = []

    for (const workspace of workspaces) {
      if (this.ctx.isDestroy) {
        const interop = this.ctx.interop(workspace)
        const isDestroyed = await interop.isDestroyed()
        if (isDestroyed) {
          logger.info(`✅ ${workspace.name} is already destroyed.`)
          continue
        }
        const inputs = await this.ctx.getInputs(workspace, { bestEffort: true })
        entries.push({ workspace, inputs })
      } else {
        const inputs = await this.ctx.getInputs(workspace)
        entries.push({ workspace, inputs })
      }
    }

    if (entries.length === 0) {
      logger.info('✅ No workspaces to apply in this level')
      return []
    }

    return this.applyWorkspaces(entries, levelIndex)
  }

  public async exec(opts: IExecOptions) {
    await this.validateEnv()

    const executionPlan = new ExecutionPlanBuilder(this.ctx).build()
    const startIndex = await this.resolveStartLevel(executionPlan)
    logger.info(`\n Selected Environment: ${this.ctx.env}`)

    for (let levelIndex = startIndex; levelIndex < executionPlan.levelsCount; levelIndex++) {
      const level = executionPlan.levels[levelIndex]

      logger.info(`\n🔧 Processing Level ${levelIndex + 1}/${executionPlan.levelsCount}`)
      logger.info('=====================================')

      if (isLevelApproved(opts.approve, levelIndex + 1)) {
        const wsStates = await this.applyLevelDirectly(level.workspaces, levelIndex)
        logger.info(`✅ Level ${levelIndex + 1} completed${formatLevelChangeSummary(wsStates)}`)
        continue
      }

      const levelPlans = await this.gatherLevelPlans(level.workspaces, { savePlanFile: true })

      if (levelPlans.length === 0) {
        logger.info('✅ No changes needed in this level')
        continue
      }

      this.logPlanSummary(levelIndex, levelPlans, opts.formatter, { skipFormattedPlan: true })

      let message = levelPlans
        .map(({ workspace, plan }) => {
          const formatted = opts.formatter.format(plan)
          return `${workspace.name}:\n${formatted}`
        })
        .join('\n\n')

      message += '\n--------------------------------\n'
      message += `Apply all workspaces in Level ${levelIndex + 1}?`

      const answer = await opts.integration.askForConfirmation(message)

      if (!opts.integration.interactive) {
        logger.info('Not interactive, waiting for confirmation and another cli execution')
        return
      }

      if (!answer) {
        logger.info('Aborting...')
        return
      }

      const entries = levelPlans.map(({ workspace, inputs, plan }) => {
        const entry: { workspace: Workspace; inputs: ProviderInput; planFile?: string } = { workspace, inputs }
        if (plan.planFile) entry.planFile = plan.planFile
        return entry
      })
      const wsStates = await this.applyWorkspaces(entries, levelIndex)

      logger.info(`✅ Level ${levelIndex + 1} completed${formatLevelChangeSummary(wsStates)}`)
    }

    logger.info('\n--------------------------------')
    if (this.ctx.isDestroy) {
      logger.info('🎉 Infrastructure destroyed successfully')
    } else {
      logger.info('🎉 Infrastructure applied successfully')
      if (!this.ctx.currentWorkspace) {
        const result: Record<string, string> = {}
        for (const exp of this.ctx.monorepo.exports) {
          const outputValue = exp.workspace ? this.ctx.findAppliedOutput(exp.workspace, exp.key) : undefined
          if (outputValue === undefined) {
            logger.warn(`Value to output ${exp.key} from workspace ${exp.workspace} is not found`)
          } else {
            result[exp.name] = outputValue.secret ? '[secret]' : outputValue.value
          }
        }
        logger.info('Outputs:')
        logger.info(JSON.stringify(result, null, 2))
      }
    }
  }

  public async drift(opts: IDriftOptions): Promise<DriftResult> {
    await this.validateEnv()

    const executionPlan = new ExecutionPlanBuilder(this.ctx).build()
    logger.info(`\n Selected Environment: ${this.ctx.env}`)

    const workspaceReports: WorkspaceDriftReport[] = []
    let hasDrift = false

    for (let levelIndex = 0; levelIndex < executionPlan.levelsCount; levelIndex++) {
      const level = executionPlan.levels[levelIndex]

      logger.info(`\n🔧 Checking Level ${levelIndex + 1}/${executionPlan.levelsCount}`)
      logger.info('=====================================')

      for (const workspace of level.workspaces) {
        const inputs: ProviderInput = await this.ctx.getInputs(workspace)
        const interop = this.ctx.interop(workspace)

        // Infrastructure drift: cloud ≠ state (always run)
        const infraPlan = await interop.getDriftPlan(inputs)
        const hasInfraDrift = hasChanges(infraPlan)

        // Configuration drift: code ≠ state (skip when --refresh-only)
        // refresh: false prevents terraform from re-checking cloud state, isolating code-vs-state changes
        let configPlan: ProviderPlan | null = null
        let hasConfigDrift = false
        if (!opts.refreshOnly) {
          configPlan = await interop.getPlan(inputs, { refresh: false })
          hasConfigDrift = hasChanges(configPlan)
        }

        const wsDrift = hasInfraDrift || hasConfigDrift

        workspaceReports.push({
          name: workspace.name,
          provider: workspace.providerName,
          hasDrift: wsDrift,
          plan: infraPlan,
          infrastructureDrift: {
            hasDrift: hasInfraDrift,
            plan: infraPlan,
          },
          configurationDrift: {
            hasDrift: hasConfigDrift,
            plan: configPlan,
          },
        })

        if (wsDrift) {
          hasDrift = true
          if (hasInfraDrift) {
            logger.info(`⚠️  ${workspace.name} has infrastructure drift (cloud ≠ state)`)
            if (!opts.json) {
              const formatted = opts.formatter.format(infraPlan)
              logger.info(`Plan:\n${formatted}`)
            }
          }
          if (hasConfigDrift) {
            logger.info(`⚠️  ${workspace.name} has configuration drift (code ≠ state)`)
            if (!opts.json && configPlan) {
              const formatted = opts.formatter.format(configPlan)
              logger.info(`Plan:\n${formatted}`)
            }
          }
        } else {
          logger.info(`✅ ${workspace.name} is in sync`)
          const { outputs } = await interop.getOutputs({ stale: this.ctx.ignoreDependencies })
          this.ctx.storeWorkspaceOutputs(workspace, outputs)
        }
      }
    }

    const report: DriftReport = {
      environment: this.ctx.env,
      timestamp: new Date().toISOString(),
      hasDrift,
      workspaces: workspaceReports,
    }

    return { hasDrift, report }
  }

  public async refreshState(): Promise<void> {
    await this.validateEnv()

    const executionPlan = new ExecutionPlanBuilder(this.ctx).build()
    logger.info(`\n Selected Environment: ${this.ctx.env}`)

    for (let levelIndex = 0; levelIndex < executionPlan.levelsCount; levelIndex++) {
      const level = executionPlan.levels[levelIndex]

      logger.info(`\n🔧 Refreshing Level ${levelIndex + 1}/${executionPlan.levelsCount}`)
      logger.info('=====================================')

      for (const workspace of level.workspaces) {
        const inputs: ProviderInput = await this.ctx.getInputs(workspace)
        const interop = this.ctx.interop(workspace)

        logger.info(`   Refreshing ${workspace.name}...`)
        await interop.refresh(inputs)

        const { outputs } = await interop.getOutputs()
        this.ctx.storeWorkspaceOutputs(workspace, outputs)
        logger.info(`   ✅ ${workspace.name} refreshed`)
      }
    }

    logger.info('\n--------------------------------')
    logger.info('🎉 State refresh completed')
  }
}

export interface IDriftOptions {
  formatter: IFormatter
  json?: boolean
  refreshOnly?: boolean
}

export interface DriftReport {
  environment: string
  timestamp: string
  hasDrift: boolean
  workspaces: WorkspaceDriftReport[]
}

export interface WorkspaceDriftReport {
  name: string
  provider: string
  hasDrift: boolean
  plan: ProviderPlan
  infrastructureDrift: {
    hasDrift: boolean
    plan: ProviderPlan
  }
  configurationDrift: {
    hasDrift: boolean
    plan: ProviderPlan | null
  }
}

export interface DriftResult {
  hasDrift: boolean
  report: DriftReport
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
  const parts = [`+${changes.add} ~${changes.change} -${changes.remove}`]
  if (changes.replace > 0) parts.push(`±${changes.replace}`)
  return parts.join(' ')
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

function isLevelApproved(approve: number[] | 'all' | undefined, level: number): boolean {
  if (approve === undefined) return false
  if (approve === 'all') return true
  return approve.includes(level)
}

function formatLevelChangeSummary(wsStates: WorkspaceApplyState[]): string {
  const add = wsStates.reduce((s, ws) => s + ws.addCount, 0)
  const change = wsStates.reduce((s, ws) => s + ws.changeCount, 0)
  const remove = wsStates.reduce((s, ws) => s + ws.removeCount, 0)
  if (add === 0 && change === 0 && remove === 0) return ''
  return `  +${add} ~${change} -${remove}`
}

export interface IExecOptions {
  formatter: IFormatter
  integration: IIntegration
  approve?: number[] | 'all' | undefined
  preview?: boolean
}

export interface IPlanExecOptions {
  formatter: IFormatter
  detailed?: boolean
}

export interface PlanResult {
  hasChanges: boolean
}

export function hasOutputDiff(planOutputs: Output[], cachedOutputs: ProviderOutput): boolean {
  // If the plan reports no outputs, we can't detect a diff (not all providers include outputs in plan)
  if (planOutputs.length === 0) return false

  const planOutputMap = new Map(planOutputs.map((o) => [o.name, o.value]))
  const cachedKeys = new Set(Object.keys(cachedOutputs))

  for (const [name, value] of planOutputMap) {
    if (!cachedOutputs[name] || cachedOutputs[name].value !== value) return true
  }

  for (const key of cachedKeys) {
    if (!planOutputMap.has(key)) return true
  }

  return false
}
