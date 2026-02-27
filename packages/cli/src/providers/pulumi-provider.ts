import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { basename, join, resolve } from 'path'
import { access, constants as fsConstants } from 'fs'
import type { ProviderConfig, ProviderInput, ProviderOutput, OutputValue } from './provider.js'
import type { ProviderPlan, ResourceChange, Output, Diagnostic, ChangeSummary, ChangeAction } from './provider-plan.js'
import type { IProvider } from './provider.js'
import type { ExecOptions } from 'node:child_process'
import { logger, UserError, ProviderError } from '../utils/index.js'
import { mkdir } from 'fs/promises'

const execAsync = promisify(exec)
const spawnAsync = promisify(spawn)
const accessAsync = promisify(access)

class PulumiProvider implements IProvider {
  getProviderName(): string {
    return 'pulumi'
  }

  async getPlan(
    configuration: ProviderConfig,
    input: ProviderInput,
    env: string,
    _options?: { detailed?: boolean; refresh?: boolean },
  ): Promise<ProviderPlan> {
    await this.setPulumiConfig(configuration, input, env)

    const stdout = await this.execCommand(`pulumi preview --stack ${env} --json --diff`, configuration, env)

    return this.mapPulumiOutputToProviderPlan(stdout, basename(configuration.rootPath))
  }

  async apply(
    configuration: ProviderConfig,
    input: ProviderInput,
    env: string,
    options?: { skipPreview?: boolean },
  ): Promise<ProviderOutput> {
    await this.setPulumiConfig(configuration, input, env)

    const skipPreviewFlag = options?.skipPreview ? ' --skip-preview' : ''
    await this.execCommand(`pulumi up --yes --json${skipPreviewFlag}`, configuration, env)

    return this.getOutputsWithSecretDetection(configuration, env)
  }

  async getOutputs(configuration: ProviderConfig, env: string): Promise<ProviderOutput> {
    return this.getOutputsWithSecretDetection(configuration, env)
  }

  async destroyPlan(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<ProviderPlan> {
    await this.setPulumiConfig(configuration, input, env)

    const stdout = await this.execCommand(
      `pulumi destroy --preview-only --stack ${env} --diff --json`,
      configuration,
      env,
    )

    // Map Pulumi output to common ProviderPlan structure
    return this.mapPulumiOutputToProviderPlan(stdout, basename(configuration.rootPath))
  }

  async destroy(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<void> {
    await this.setPulumiConfig(configuration, input, env)

    await this.execCommand(`pulumi destroy --yes --stack ${env}`, configuration, env)
  }

  async isDestroyed(configuration: ProviderConfig, env: string): Promise<boolean> {
    const stdout = await this.execCommand(`pulumi stack ls --json`, configuration, env)
    const stacks = JSON.parse(stdout) as Array<{ name: string }>
    const stackExists = stacks.some((stack) => stack.name === env)
    if (!stackExists) {
      return true
    }
    const stateStdout = await this.execCommand(`pulumi stack --stack ${env} export`, configuration, env)
    const state = JSON.parse(stateStdout) as { deployment: { resources: Array<{ urn: string }> } }
    return !state.deployment.resources || state.deployment.resources.length === 0
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

  private mapPulumiOutputToProviderPlan(pulumiOutput: string, projectName: string): ProviderPlan {
    return parsePulumiPreviewOutput(pulumiOutput, projectName)
  }

  private async checkPulumiInstallation(): Promise<void> {
    try {
      await execAsync('pulumi version')
    } catch {
      throw new UserError(
        'Pulumi is not installed or not available in PATH. Install it from https://www.pulumi.com/docs/install/',
      )
    }
  }

  private async initializePulumi(configuration: ProviderConfig, env: string): Promise<void> {
    const backendConfig = configuration.envs?.[env]?.backend_config
    if (backendConfig?.['PULUMI_BACKEND_URL'] && backendConfig['PULUMI_BACKEND_URL'].startsWith('file://')) {
      const localBackendFolderPath = backendConfig['PULUMI_BACKEND_URL'].substring('file://'.length)
      await mkdir(resolve(configuration.rootPath, localBackendFolderPath), { recursive: true })
    }

    await this.execCommand('pulumi install', configuration, env)
    try {
      await this.execCommand(`pulumi stack select ${env}`, configuration, env)
    } catch (error) {
      if (error instanceof Error && error.message.includes(`no stack named '${env}' found`)) {
        logger.warn(`${configuration.alias}:: Stack ${env} does not exist. Creating it...`)
        await this.execCommand(`pulumi stack init ${env}`, configuration, env)
        await this.execCommand(`pulumi stack select ${env}`, configuration, env)
      } else {
        throw error
      }
    }
  }

  private async getOutputsWithSecretDetection(configuration: ProviderConfig, env: string): Promise<ProviderOutput> {
    // First call without --show-secrets to detect which keys are secret
    const publicStdout = await this.execCommand(`pulumi stack output --json`, configuration, env)
    const publicOutputs = JSON.parse(publicStdout) as Record<string, unknown>
    const secretKeys = new Set<string>()
    for (const [key, value] of Object.entries(publicOutputs)) {
      if (value === '[secret]') {
        secretKeys.add(key)
      }
    }

    // Second call with --show-secrets to get actual values
    const secretStdout = await this.execCommand(`pulumi stack output --json --show-secrets`, configuration, env)
    const fullOutputs = JSON.parse(secretStdout) as Record<string, unknown>

    return Object.fromEntries(
      Object.entries(fullOutputs).map(([key, value]) => [
        key,
        {
          value: typeof value === 'string' ? value : JSON.stringify(value),
          secret: secretKeys.has(key),
        } satisfies OutputValue,
      ]),
    )
  }

  private async setPulumiConfig(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<void> {
    const rootVars = configuration.rootVars ?? {}
    const envVars = configuration.envs?.[env]?.vars || {}
    const allVars: ProviderInput = {
      ...toNonSecretInput(rootVars),
      ...toNonSecretInput(envVars),
      ...input,
    }
    for (const [key, outputValue] of Object.entries(allVars)) {
      const secretFlag = outputValue.secret ? ' --secret' : ''
      await this.execCommand(`pulumi config set${secretFlag} ${key} -- ${outputValue.value}`, configuration, env)
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

  async getDriftPlan(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<ProviderPlan> {
    await this.setPulumiConfig(configuration, input, env)

    const stdout = await this.execCommand(`pulumi refresh --preview-only --stack ${env} --json`, configuration, env)

    return this.mapPulumiOutputToProviderPlan(stdout, basename(configuration.rootPath))
  }

  async refresh(configuration: ProviderConfig, input: ProviderInput, env: string): Promise<void> {
    await this.setPulumiConfig(configuration, input, env)

    await this.execCommand(`pulumi refresh --yes --stack ${env}`, configuration, env)
  }

  async importResource(
    configuration: ProviderConfig,
    args: string[],
    input: ProviderInput,
    env: string,
  ): Promise<string> {
    await this.setPulumiConfig(configuration, input, env)

    return await this.execCommand(`pulumi import ${args.join(' ')} --yes --stack ${env}`, configuration, env)
  }

  async generateCode(
    configuration: ProviderConfig,
    args: string[],
    input: ProviderInput,
    env: string,
  ): Promise<string> {
    await this.setPulumiConfig(configuration, input, env)

    return await this.execCommand(
      `pulumi import ${args.join(' ')} --generate-code --yes --stack ${env}`,
      configuration,
      env,
    )
  }

  async execAnyCommand(
    command: string[],
    configuration: ProviderConfig,
    input: () => Promise<ProviderInput>,
    env: string,
  ): Promise<void> {
    await this.setPulumiConfig(configuration, await input(), env)
    await this.execCommandInteractive(`pulumi ${command.join(' ')}`, configuration, env)
  }

  private async execCommandInteractive(command: string, configuration: ProviderConfig, env: string): Promise<void> {
    const options = this.getDefaultExecOptions(configuration, env)
    logger.debug(`[pulumi] exec (interactive): ${command}\n  cwd: ${configuration.rootPath}`)
    await spawnAsync(command, [], {
      shell: true,
      stdio: 'inherit',
      cwd: options.cwd as string,
      env: options.env as NodeJS.ProcessEnv,
    })
  }

  private async execCommand(command: string, configuration: ProviderConfig, env: string): Promise<string> {
    try {
      logger.debug(`[pulumi] exec: ${command}\n  cwd: ${configuration.rootPath}`)
      const { stdout, stderr } = await execAsync(command, this.getDefaultExecOptions(configuration, env))
      if (stderr && stderr.trim()) {
        logger.debug(`[pulumi] stderr:\n${stderr}`)
      }
      if (stdout && stdout.trim()) {
        logger.debug(`[pulumi] stdout (raw):\n${stdout}`)
      }
      return stdout
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string; stdout?: string }
        logger.debug(
          `[pulumi] exec failed: ${command}\n  cwd: ${configuration.rootPath}\n  code: ${err.code}\n  stderr:\n${err.stderr}\n  stdout (raw):\n${err.stdout}`,
        )
        const messageParts = [
          `Pulumi command failed in ${configuration.alias}:`,
          `Command: ${command}`,
          `Error message: ${error.message}`,
          `Error code: ${err.code}`,
          `Error stderr: ${err.stderr}`,
          `Error stdout: ${err.stdout}`,
        ]
        throw new ProviderError(messageParts.join('\n\t'), 'pulumi', configuration.alias)
      }
      throw error
    }
  }
}

function toNonSecretInput(vars: Record<string, string>): ProviderInput {
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, { value: v, secret: false }]))
}

export const pulumiProvider = new PulumiProvider() as IProvider

export function parsePulumiPreviewOutput(pulumiOutput: string, projectName: string): ProviderPlan {
  const resourceChanges: Array<ResourceChange> = []
  const outputs: Array<Output> = []
  const diagnostics: Array<Diagnostic> = []
  let changeSummary: ChangeSummary = {
    add: 0,
    change: 0,
    remove: 0,
    replace: 0,
    outputUpdates: 0,
  }

  const previewResult = JSON.parse(pulumiOutput)

  if (previewResult.steps) {
    for (const step of previewResult.steps) {
      const urn = step.urn
      const urnParts = urn.split('::')
      const resourceType = urnParts[urnParts.length - 2] || 'unknown'
      const resourceName = urnParts.pop() || 'unknown'

      let actions: Array<ChangeAction> = []
      switch (step.op) {
        case 'create':
          actions = ['create']
          changeSummary = {
            add: changeSummary.add + 1,
            change: changeSummary.change,
            remove: changeSummary.remove,
            replace: changeSummary.replace,
            outputUpdates: 0,
          }
          break
        case 'update':
          actions = ['update']
          changeSummary = {
            add: changeSummary.add,
            change: changeSummary.change + 1,
            remove: changeSummary.remove,
            replace: changeSummary.replace,
            outputUpdates: 0,
          }
          break
        case 'delete':
          actions = ['delete']
          changeSummary = {
            add: changeSummary.add,
            change: changeSummary.change,
            remove: changeSummary.remove + 1,
            replace: changeSummary.replace,
            outputUpdates: 0,
          }
          break
        case 'replace':
          actions = ['replace']
          changeSummary = {
            add: changeSummary.add,
            change: changeSummary.change,
            remove: changeSummary.remove,
            replace: changeSummary.replace + 1,
            outputUpdates: 0,
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
        before: step.oldState?.inputs ?? null,
        after: step.newState?.inputs ?? step.resource?.properties ?? null,
        metadata: {},
      })
    }
  }

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
