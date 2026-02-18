import { exec } from 'child_process'
import { promisify } from 'util'
import { basename, extname, join } from 'path'
import { readdir, copyFile, rm, access, constants, writeFile } from 'fs/promises'
import type { IProvider, ProviderConfig } from './provider.js'
import type { ProviderInput, ProviderOutput } from './provider.js'
import type { ProviderPlan, ResourceChange, Output, Diagnostic } from './provider-plan.js'
import { logger, UserError, ProviderError } from '../utils/index.js'
import { StateManager } from '../core/index.js'
import { spawn } from 'node:child_process'

const execAsync = promisify(exec)
const spawnAsync = promisify(spawn)

class TerraformProvider implements IProvider {
  getProviderName(): string {
    return 'terraform'
  }

  async getPlan(configuration: ProviderConfig, input: ProviderInput, environment: string): Promise<ProviderPlan> {
    const variables = await this.getVariableString(configuration, input, environment)

    const stdout = await this.execCommand(`terraform plan --json ${variables}`, configuration)

    return this.mapTerraformOutputToProviderPlan(stdout, basename(configuration.rootPath))
  }

  async apply(configuration: ProviderConfig, input: ProviderInput, environment: string): Promise<ProviderOutput> {
    const variables = await this.getVariableString(configuration, input, environment)

    await this.execCommand(`terraform apply --auto-approve --json ${variables}`, configuration)

    const stdout = await this.execCommand(`terraform output --json`, configuration)

    const outputs = JSON.parse(stdout) as Record<string, { value: string }>

    return Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, value.value]))
  }

  async getOutputs(configuration: ProviderConfig): Promise<ProviderOutput> {
    const stdout = await this.execCommand(`terraform output --json`, configuration)
    const outputs = JSON.parse(stdout) as Record<string, { value: string }>

    return Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, value.value]))
  }

  async destroyPlan(configuration: ProviderConfig, input: ProviderInput, environment: string): Promise<ProviderPlan> {
    const variables = await this.getVariableString(configuration, input, environment)

    const stdout = await this.execCommand(`terraform plan -destroy --json ${variables}`, configuration)

    return this.mapTerraformOutputToProviderPlan(stdout, basename(configuration.rootPath))
  }

  async destroy(configuration: ProviderConfig, input: ProviderInput, environment: string): Promise<void> {
    const variables = await this.getVariableString(configuration, input, environment)

    await this.execCommand(`terraform destroy --auto-approve ${variables}`, configuration)
  }

  async isDestroyed(configuration: ProviderConfig): Promise<boolean> {
    const stdout = await this.execCommand(`terraform state list`, configuration)
    return stdout.trim() === ''
  }

  async selectEnvironment(configuration: ProviderConfig, env: string): Promise<void> {
    await this.checkTerraformInstallation()

    await this.initializeTerraform(configuration, env)
  }

  async existsInFolder(folderPath: string): Promise<boolean> {
    try {
      const files = await readdir(folderPath)
      return files.some((file) => extname(file).toLowerCase() === '.tf')
    } catch {
      return false
    }
  }

  private mapTerraformOutputToProviderPlan(terraformOutput: string, projectName: string): ProviderPlan {
    return parseTerraformPlanOutput(terraformOutput, projectName)
  }

  private async checkTerraformInstallation(): Promise<void> {
    try {
      const cmd = 'terraform version'
      logger.debug(`[terraform] exec: ${cmd}`)
      const { stdout, stderr } = await execAsync(cmd)
      if (stderr && stderr.trim()) logger.debug(`[terraform] stderr:\n${stderr}`)
      if (stdout && stdout.trim()) logger.debug(`[terraform] stdout (raw):\n${stdout}`)
    } catch {
      throw new UserError(
        'Terraform is not installed or not available in PATH. Install it from https://developer.hashicorp.com/terraform/install',
      )
    }
  }

  private backendConfigToArgs(config?: Record<string, string>): string {
    if (!config) return ''
    return Object.entries(config)
      .map(([k, v]) => `--backend-config="${k}=${v}"`)
      .join(' ')
  }

  private async initializeTerraform(configuration: ProviderConfig, environment: string): Promise<void> {
    try {
      const BACKEND_CONFIG_FILE = join(configuration.rootPath, '__ig__backend.tf')

      const selectedEnv = configuration.envs?.[environment]

      const backendFile = selectedEnv?.backend_file
      const backendType = selectedEnv?.backend_type
      if (backendFile) {
        await copyFile(join(configuration.rootPath, backendFile), BACKEND_CONFIG_FILE)
      } else if (backendType) {
        await writeFile(BACKEND_CONFIG_FILE, `terraform { \n  backend "${backendType}" {} \n}`)
      } else {
        if (
          await access(BACKEND_CONFIG_FILE, constants.W_OK)
            .then(() => true)
            .catch(() => false)
        ) {
          await rm(BACKEND_CONFIG_FILE)
        }
      }
      const backendConfigArgs = this.backendConfigToArgs(selectedEnv?.backend_config)
      await this.execCommand(`terraform init ${backendConfigArgs} --reconfigure`, configuration)
    } catch (error) {
      throw new ProviderError(
        `Failed to initialize Terraform in ${configuration.alias}`,
        'terraform',
        configuration.alias,
      )
    }
  }

  private async getVariableString(configuration: ProviderConfig, input: ProviderInput, environment: string) {
    const { var_files, vars } = configuration.envs?.[environment] || { vars: {}, var_files: [] }
    const variables = Object.entries({ ...vars, ...input }) // TODO: what is more important? or maybe error in case of collision?
      .map(([key, value]) => `${key}="${value}"`)
      .join('\n')
    const stateManager = new StateManager(configuration.rootMonoRepoFolder)
    const tempVarFile = await stateManager.storeWorkspaceTempFile(
      configuration.rootPath,
      'terraform-vars.tfvars',
      variables,
    )
    const filesStr = var_files?.map((f: string) => `-var-file=${f}`)?.join(' ') || ''
    return `${filesStr} -var-file=${tempVarFile}`
  }

  async execAnyCommand(
    command: string[],
    configuration: ProviderConfig,
    input: () => Promise<ProviderInput>,
    env: string,
  ): Promise<void> {
    const needInputCommands = ['apply', 'destroy', 'plan', 'import', 'refresh']
    const notSupportedCommands = ['console', 'workspace', 'test']
    const tfCommand = command[0]
    if (notSupportedCommands.includes(tfCommand)) {
      throw new UserError(`Command "${tfCommand}" is not supported`)
    }

    const args = ['terraform', tfCommand]
    if (needInputCommands.includes(tfCommand)) {
      const variables = await this.getVariableString(configuration, await input(), env)
      args.push(variables)
    }

    args.push(...command.slice(1))

    await this.execCommandInteractive(args.join(' '), configuration)
  }

  private async execCommandInteractive(command: string, configuration: ProviderConfig): Promise<void> {
    logger.debug(`[terraform] exec: ${command}\n  cwd: ${configuration.rootPath}`)
    await spawnAsync(command, [], {
      shell: true,
      stdio: 'inherit',
    })
  }

  private async execCommand(command: string, configuration: ProviderConfig): Promise<string> {
    try {
      logger.debug(`[terraform] exec: ${command}\n  cwd: ${configuration.rootPath}`)
      const { stdout, stderr } = await execAsync(command, {
        cwd: configuration.rootPath,
      })
      if (stderr && stderr.trim()) {
        logger.debug(`[terraform] stderr:\n${stderr}`)
      }
      if (stdout && stdout.trim()) {
        logger.debug(`[terraform] stdout (raw):\n${stdout}`)
      }
      return stdout
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string; stdout?: string }
        logger.debug(
          `[terraform] exec failed: ${command}\n  cwd: ${configuration.rootPath}\n  code: ${err.code}\n  stderr:\n${err.stderr}\n  stdout (raw):\n${err.stdout}`,
        )
        const messageParts = [
          `Terraform command failed in ${configuration.alias}:`,
          `Command: ${command}`,
          `Error message: ${error.message}`,
          `Error code: ${err.code}`,
          `Error stderr: ${err.stderr}`,
          `Error stdout: ${err.stdout}`,
        ]
        throw new ProviderError(messageParts.join('\n\t'), 'terraform', configuration.alias)
      }
      throw error
    }
  }
}

export const terraformProvider = new TerraformProvider() as IProvider

export function parseTerraformPlanOutput(terraformOutput: string, projectName: string): ProviderPlan {
  const resourceChanges: Array<ResourceChange> = []
  const outputs: Array<Output> = []
  const diagnostics: Array<Diagnostic> = []
  let changeSummary = {
    add: 0,
    change: 0,
    remove: 0,
    replace: 0,
    outputUpdates: 0,
  }

  const jsonLines = terraformOutput.trim().split('\n')
  const jsonObjects = jsonLines.map((line) => JSON.parse(line))

  for (const obj of jsonObjects) {
    if (obj.type === 'planned_change') {
      const change = obj.change
      const resource = change.resource

      resourceChanges.push({
        address: resource.addr,
        type: resource.resource_type,
        name: resource.resource_name,
        actions: [change.action],
        status: 'pending',
        before: change.before,
        after: change.after,
        metadata: {},
      })
    }

    if (obj.type === 'outputs') {
      for (const [name, output] of Object.entries(obj.outputs)) {
        const tfOutput = output as { value?: string; sensitive?: boolean; action?: string }
        const o: Output = {
          name,
          value: tfOutput.value || 'TO_BE_DEFINED',
          sensitive: tfOutput.sensitive || false,
          description: null,
          action:
            tfOutput.action === 'create'
              ? 'added'
              : tfOutput.action === 'update'
                ? 'updated'
                : tfOutput.action === 'delete'
                  ? 'deleted'
                  : undefined,
        }
        outputs.push(o)
        if (o.action) {
          changeSummary.outputUpdates++
        }
      }
    }

    if (obj.type === 'change_summary') {
      changeSummary = {
        add: obj.changes.add || 0,
        change: obj.changes.change || 0,
        remove: obj.changes.remove || 0,
        replace: obj.changes.replace || 0,
        outputUpdates: changeSummary.outputUpdates || 0,
      }
    }

    if (obj.type === 'diagnostic') {
      diagnostics.push({
        severity: obj.diagnostic.severity,
        summary: obj.diagnostic.summary,
        detail: obj.diagnostic.detail,
        address: obj.diagnostic.address,
        source: null,
      })
    }
  }

  return {
    provider: 'terraform',
    projectName,
    timestamp: new Date(),
    resourceChanges,
    outputs,
    diagnostics,
    changeSummary,
    metadata: { rawOutput: terraformOutput },
  }
}
