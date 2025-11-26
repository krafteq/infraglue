import { StateManager } from './state-manager'
import { Monorepo } from './model'
import { logger } from '../utils/logger'
import { UserError } from '../utils/errors'
import { WorkspaceInterop } from './workspace-interop'

export class EnvManager {
  private readonly stateManager: StateManager

  public constructor(private readonly monorepo: Monorepo) {
    this.stateManager = new StateManager(this.monorepo.path)
  }

  public async selectEnv(env: string) {
    logger.info(`Setting environment to ${env}`)

    // workspace may not contain requested environment
    const affectedWorkspaces = this.monorepo.workspaces.filter((x) => x.hasEnv(env))
    const currentState = await this.stateManager.read()
    if (
      currentState.isEnvSelected &&
      currentState.env === env &&
      !affectedWorkspaces.filter((w) => currentState.workspace(w.name).env !== env)
    ) {
      logger.info(`Environment is already set to ${env}`)
      return
    }

    await this.stateManager.update((s) => s.startSelectingEnv(env))

    await Promise.all(
      affectedWorkspaces.map((x) => {
        const interop = new WorkspaceInterop(this.monorepo, x, env)
        return interop.selectEnvironment()
      }),
    )

    await this.stateManager.update((s) => s.finishEnvSelection(affectedWorkspaces.map((x) => x.name)))

    logger.info('Environment selected successfully')
  }

  public async selectedEnv(): Promise<string | undefined> {
    const state = await this.stateManager.read()
    if (!state.isEnvSelected) {
      throw new UserError(`No environment selected`)
    }
    return state.env
  }
}
