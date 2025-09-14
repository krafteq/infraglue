import { exec } from 'child_process'
import { promisify } from 'util'
import { basename, extname, join } from 'path'
import { readdir, copyFile, rm, access, constants, writeFile } from 'fs/promises'
import type { ProviderConfig } from '../core/index.js'
import type { IProvider } from './provider.js'
import type { ProviderInput, ProviderOutput } from './provider.js'
import type { ProviderPlan, ResourceChange, Output, Diagnostic, ChangeSummary } from './provider-plan.js'

const execAsync = promisify(exec)

class TerraformProvider implements IProvider {
  getProviderName(): string {
    return 'terraform'
  }

  async getPlan(configuration: ProviderConfig, input: ProviderInput, environment: string): Promise<ProviderPlan> {
    const variables = this.getVariableString(configuration, input, environment)

    const stdout = await this.execCommand(`terraform plan --json ${variables}`, configuration)

    return this.mapTerraformOutputToProviderPlan(stdout, basename(configuration.rootPath))
  }

  async apply(configuration: ProviderConfig, input: ProviderInput, environment: string): Promise<ProviderOutput> {
    const variables = this.getVariableString(configuration, input, environment)

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
    const variables = this.getVariableString(configuration, input, environment)

    const stdout = await this.execCommand(`terraform plan -destroy --json ${variables}`, configuration)

    return this.mapTerraformOutputToProviderPlan(stdout, basename(configuration.rootPath))
  }

  async destroy(configuration: ProviderConfig, input: ProviderInput, environment: string): Promise<void> {
    const variables = this.getVariableString(configuration, input, environment)

    await this.execCommand(`terraform destroy --auto-approve ${variables}`, configuration)
  }

  async isDestroyed(configuration: ProviderConfig): Promise<boolean> {
    const stdout = await this.execCommand(`terraform state list`, configuration, false)
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

  /**
   * Maps Terraform JSON output to the common ProviderPlan structure
   * This encapsulates all Terraform-specific parsing logic
   */
  private mapTerraformOutputToProviderPlan(terraformOutput: string, projectName: string): ProviderPlan {
    const resourceChanges: Array<ResourceChange> = []
    const outputs: Array<Output> = []
    const diagnostics: Array<Diagnostic> = []
    let changeSummary: ChangeSummary = {
      add: 0,
      change: 0,
      remove: 0,
      replace: 0,
    }

    // Parse the JSON lines from Terraform output
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
          const terraformOutput = output as { value?: string; sensitive?: boolean }
          outputs.push({
            name,
            value: terraformOutput.value || 'TO_BE_DEFINED',
            sensitive: terraformOutput.sensitive || false,
            description: null,
          })
        }
      }

      if (obj.type === 'change_summary') {
        changeSummary = {
          add: obj.changes.add || 0,
          change: obj.changes.change || 0,
          remove: obj.changes.remove || 0,
          replace: obj.changes.replace || 0,
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

  private async checkTerraformInstallation(): Promise<void> {
    try {
      await execAsync('terraform version')
    } catch {
      throw new Error('Terraform is not installed or not available in PATH')
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

      const backendFile = configuration.envs?.[environment]?.backend_file
      const backendType = configuration.envs?.[environment]?.backend_type
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
      const backendConfigArgs = this.backendConfigToArgs(configuration.envs?.[environment]?.backend_config)
      await this.execCommand(`terraform init ${backendConfigArgs} --reconfigure`, configuration, false)
    } catch (error) {
      throw new Error(`Failed to initialize Terraform in ${configuration.alias}`, { cause: error })
    }
  }

  private getVariableString(configuration: ProviderConfig, input: ProviderInput, environment: string) {
    const { var_files, vars } = configuration.envs?.[environment] || { vars: {}, var_files: [] }
    const variables = Object.entries({ ...vars, ...input }) // TODO: what is more important? or maybe error in case of collision?
      .map(([key, value]) => `-var "${key}=${value}"`)
      .join(' ')
    const filesStr = var_files?.map((f) => `-var-file=${f}`)?.join(' ') || ''
    return [filesStr, variables].join(' ')
  }

  private async execCommand(
    command: string,
    configuration: ProviderConfig,
    expectedJson: boolean = true,
  ): Promise<string> {
    try {
      const { stdout } = await execAsync(command, {
        cwd: configuration.rootPath,
      })

      return stdout
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string; stdout?: string }
        const messageParts = [
          `Terraform command failed in ${configuration.alias}:`,
          `Command: ${command}`,
          `Error message: ${error.message}`,
          `Error code: ${err.code}`,
          `Error stderr: ${err.stderr}`,
          `Error stdout: ${expectedJson && err.stdout ? this.tryParseJsonStdout(err.stdout) : err.stdout}`,
        ]
        throw new Error(messageParts.join('\n\t'))
      }
      throw error
    }
  }
  private tryParseJsonStdout(stdout: string): string {
    try {
      const parsed = stdout
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as { '@message': string; diagnostic?: { summary: string } })

      return parsed
        .map((x) => `${x['@message']}${x.diagnostic?.summary ? `\n\t\t\t${x.diagnostic.summary}` : ''}`)
        .join('\n\t\t')
    } catch {
      return stdout
    }
  }
}

export const terraformProvider = new TerraformProvider() as IProvider
