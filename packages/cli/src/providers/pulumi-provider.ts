import { exec } from 'child_process'
import { promisify } from 'util'
import { basename, join } from 'path'
import { access, constants as fsConstants } from 'fs'
import type { ProviderConfig } from '../core/index.js'
import type { ProviderInput, ProviderOutput } from './provider.js'
import type { ProviderPlan, ResourceChange, Output, Diagnostic, ChangeSummary, ChangeAction } from './provider-plan.js'
import type { IProvider } from './provider.js'
import type { ExecOptions } from 'node:child_process'

const execAsync = promisify(exec)
const accessAsync = promisify(access)

class PulumiProvider implements IProvider {
  getProviderName(): string {
    return 'pulumi'
  }

  async getPlan(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<ProviderPlan> {
    try {
      await this.setPulumiConfig(configuration, input, env)

      const options = this.getDefaultExecOptions(configuration, env)
      const { stdout } = await execAsync(`pulumi preview --stack ${env} --json --diff`, options)

      return this.mapPulumiOutputToProviderPlan(stdout, basename(configuration.rootPath))
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string }
        throw new Error(
          `Pulumi preview failed in ${configuration.alias}: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}`,
        )
      }
      throw error
    }
  }

  async apply(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<ProviderOutput> {
    try {
      await this.setPulumiConfig(configuration, input, env)

      const options = this.getDefaultExecOptions(configuration, env)
      await execAsync(`pulumi up --yes --json`, options)

      const { stdout: outputStdout } = await execAsync(`pulumi stack output --json`, options)

      const outputs = JSON.parse(outputStdout) as Record<string, { value: unknown }>

      return Object.fromEntries(
        Object.entries(outputs).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : JSON.stringify(value.value),
        ]),
      )
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string; stdout?: string }
        throw new Error(
          `Pulumi up failed in ${configuration.alias}: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}\n error stdout: ${err.stdout}`,
        )
      }
      throw error
    }
  }

  async getOutputs(configuration: ProviderConfig, env: string): Promise<ProviderOutput> {
    try {
      const options = this.getDefaultExecOptions(configuration, env)
      const { stdout: outputStdout } = await execAsync(`pulumi stack output --json`, options)

      const outputs = JSON.parse(outputStdout) as Record<string, unknown>
      return Object.fromEntries(
        Object.entries(outputs).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
      )
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string; stdout?: string }
        throw new Error(
          `Pulumi output failed in ${configuration.alias}: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}\n error stdout: ${err.stdout}`,
        )
      }
      throw error
    }
  }

  async destroyPlan(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<ProviderPlan> {
    try {
      await this.setPulumiConfig(configuration, input, env)

      const options = this.getDefaultExecOptions(configuration, env)
      const { stdout } = await execAsync(`pulumi destroy --preview-only --stack ${env} --diff --json`, options)

      // Map Pulumi output to common ProviderPlan structure
      return this.mapPulumiOutputToProviderPlan(stdout, basename(configuration.rootPath))
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string }
        throw new Error(
          `Pulumi destroy preview failed in ${configuration.alias}: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}`,
        )
      }
      throw error
    }
  }

  async destroy(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<void> {
    try {
      await this.setPulumiConfig(configuration, input, env)

      const options = this.getDefaultExecOptions(configuration, env)
      await execAsync(`pulumi destroy --yes --stack ${env}`, options)
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string }
        throw new Error(
          `Pulumi destroy preview failed in ${configuration.alias}: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}`,
        )
      }
      throw error
    }
  }

  async isDestroyed(configuration: ProviderConfig, env: string): Promise<boolean> {
    try {
      const options = this.getDefaultExecOptions(configuration, env)
      const { stdout } = await execAsync(`pulumi stack ls --json`, options)
      const stacks = JSON.parse(stdout) as Array<{ name: string }>
      const stackExists = stacks.some((stack) => stack.name === env)
      if (!stackExists) {
        return true
      }
      const { stdout: stateStdout } = await execAsync(`pulumi stack --stack ${env} export`, options)
      const state = JSON.parse(stateStdout) as { deployment: { resources: Array<{ urn: string }> } }
      return !state.deployment.resources || state.deployment.resources.length === 0
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string }
        throw new Error(
          `Pulumi destroy preview failed in ${configuration.alias}: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}`,
        )
      }
      throw error
    }
  }

  async selectEnvironment(configuration: ProviderConfig, env: string): Promise<void> {
    await this.checkPulumiInstallation()
    await this.initializePulumi(configuration, env)
  }

  async existsInFolder(folderPath: string): Promise<boolean> {
    try {
      await accessAsync(join(folderPath, 'Pulumi.yaml'), fsConstants.R_OK)
      return true
    } catch {
      return false
    }
  }

  /**
   * Maps Pulumi JSON output to the common ProviderPlan structure
   * This encapsulates all Pulumi-specific parsing logic
   */
  private mapPulumiOutputToProviderPlan(pulumiOutput: string, projectName: string): ProviderPlan {
    const resourceChanges: Array<ResourceChange> = []
    const outputs: Array<Output> = []
    const diagnostics: Array<Diagnostic> = []
    let changeSummary: ChangeSummary = {
      add: 0,
      change: 0,
      remove: 0,
      replace: 0,
    }

    const previewResult = JSON.parse(pulumiOutput)

    // Process resource changes from steps
    if (previewResult.steps) {
      for (const step of previewResult.steps) {
        const urn = step.urn
        const urnParts = urn.split('::')
        const resourceType = urnParts[urnParts.length - 2] || 'unknown'
        const resourceName = urnParts.pop() || 'unknown'

        // Map Pulumi operations to our change actions
        let actions: Array<ChangeAction> = []
        switch (step.op) {
          case 'create':
            actions = ['create']
            changeSummary = {
              add: changeSummary.add + 1,
              change: changeSummary.change,
              remove: changeSummary.remove,
              replace: changeSummary.replace,
            }
            break
          case 'update':
            actions = ['update']
            changeSummary = {
              add: changeSummary.add,
              change: changeSummary.change + 1,
              remove: changeSummary.remove,
              replace: changeSummary.replace,
            }
            break
          case 'delete':
            actions = ['delete']
            changeSummary = {
              add: changeSummary.add,
              change: changeSummary.change,
              remove: changeSummary.remove + 1,
              replace: changeSummary.replace,
            }
            break
          case 'replace':
            actions = ['replace']
            changeSummary = {
              add: changeSummary.add,
              change: changeSummary.change,
              remove: changeSummary.remove,
              replace: changeSummary.replace + 1,
            }
            break
          case 'same':
            actions = ['no-op']
            break
          default:
            actions = [step.op as ChangeAction]
        }

        resourceChanges.push({
          address: urn,
          type: resourceType,
          name: resourceName,
          actions,
          status: 'pending',
          before: null,
          after: step.resource?.properties || null,
          metadata: {},
        })
      }
    }

    // Process outputs
    if (previewResult.outputs) {
      for (const [name, value] of Object.entries(previewResult.outputs)) {
        outputs.push({
          name,
          value: typeof value === 'string' ? value : JSON.stringify(value),
          sensitive: false,
          description: null,
        })
      }
    }

    return {
      provider: 'pulumi',
      projectName,
      timestamp: new Date(),
      resourceChanges,
      outputs,
      diagnostics,
      changeSummary,
      metadata: { rawOutput: pulumiOutput },
    }
  }

  private async checkPulumiInstallation(): Promise<void> {
    try {
      await execAsync('pulumi version')
    } catch {
      throw new Error('Pulumi is not installed or not available in PATH')
    }
  }

  private async initializePulumi(configuration: ProviderConfig, env: string): Promise<void> {
    try {
      const options = this.getDefaultExecOptions(configuration, env)
      await execAsync('pulumi install', options)
      try {
        await execAsync(`pulumi stack select ${env}`, options)
      } catch (error) {
        if (error instanceof Error && error.message.includes(`no stack named '${env}' found`)) {
          await execAsync(`pulumi stack init ${env}`, options)
          await execAsync(`pulumi stack select ${env}`, options)
        } else {
          throw error
        }
      }
    } catch (error) {
      throw new Error(
        `Failed to initialize Pulumi in ${configuration.alias}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  private async setPulumiConfig(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<void> {
    try {
      const envVars = configuration.envs?.[env]?.vars || {}
      const options = this.getDefaultExecOptions(configuration, env)
      // TODO: what should have higher priority? input or env?
      for (const [key, value] of Object.entries({ ...envVars, ...input })) {
        await execAsync(`pulumi config set ${key} ${value}`, options)
      }
    } catch (error) {
      throw new Error(
        `Failed to set Pulumi config in ${configuration.alias}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  private getDefaultExecOptions(configuration: ProviderConfig, env: string): ExecOptions {
    const backendConfig = configuration.envs?.[env]?.backend_config
    const options: ExecOptions = {
      cwd: configuration.rootPath,
    }
    if (backendConfig) {
      options.env = {
        ...process.env,
        ...backendConfig,
      }
    }
    return options
  }
}

export const pulumiProvider = new PulumiProvider() as IProvider
