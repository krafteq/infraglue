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
    try {
      const variables = this.getVariableString(configuration, input, environment)

      const { stdout } = await execAsync(`terraform plan --json ${variables}`, {
        cwd: configuration.rootPath,
      })

      return this.mapTerraformOutputToProviderPlan(stdout, basename(configuration.rootPath))
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string; stdout?: string }
        throw new Error(
          `Terraform plan failed: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}\n error stdout: ${err.stdout}`,
        )
      }
      throw error
    }
  }

  async apply(configuration: ProviderConfig, input: ProviderInput, environment: string): Promise<ProviderOutput> {
    try {
      const variables = this.getVariableString(configuration, input, environment)

      await execAsync(`terraform apply --auto-approve --json ${variables}`, {
        cwd: configuration.rootPath,
      })

      const { stdout: outputStdout } = await execAsync(`terraform output --json`, {
        cwd: configuration.rootPath,
      })

      const outputs = JSON.parse(outputStdout) as Record<string, { value: string }>

      return Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, value.value]))
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string; stdout?: string }
        throw new Error(
          `Terraform apply failed: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}\n error stdout: ${err.stdout}`,
        )
      }
      throw error
    }
  }

  async getOutputs(configuration: ProviderConfig): Promise<ProviderOutput> {
    try {
      const { stdout: outputStdout } = await execAsync(`terraform output --json`, {
        cwd: configuration.rootPath,
      })
      const outputs = JSON.parse(outputStdout) as Record<string, { value: string }>

      return Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, value.value]))
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string; stdout?: string }
        throw new Error(
          `Terraform output failed: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}\n error stdout: ${err.stdout}`,
        )
      }
      throw error
    }
  }

  async destroyPlan(configuration: ProviderConfig, input: ProviderInput, environment: string): Promise<ProviderPlan> {
    try {
      const variables = this.getVariableString(configuration, input, environment)

      const { stdout } = await execAsync(`terraform plan -destroy --json ${variables}`, {
        cwd: configuration.rootPath,
      })

      return this.mapTerraformOutputToProviderPlan(stdout, basename(configuration.rootPath))
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string; stdout?: string }
        throw new Error(
          `Terraform destroy preview failed: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}\n error stdout: ${err.stdout}`,
        )
      }
      throw error
    }
  }

  async destroy(configuration: ProviderConfig, input: ProviderInput, environment: string): Promise<void> {
    try {
      const variables = this.getVariableString(configuration, input, environment)

      await execAsync(`terraform destroy --auto-approve ${variables}`, {
        cwd: configuration.rootPath,
      })
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string; stdout?: string }
        throw new Error(
          `Terraform destroy preview failed: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}\n error stdout: ${err.stdout}`,
        )
      }
      throw error
    }
  }

  async isDestroyed(configuration: ProviderConfig): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`terraform state list`, {
        cwd: configuration.rootPath,
      })
      return stdout.trim() === ''
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string; stdout?: string }
        throw new Error(
          `Terraform destroy preview failed: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}\n error stdout: ${err.stdout}`,
        )
      }
      throw error
    }
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
      // TODO: double check --reconfigure, it could be expensive, mb we need init as a separate step?
      await execAsync(`terraform init ${backendConfigArgs} --reconfigure`, { cwd: configuration.rootPath })
    } catch (error) {
      throw new Error(`Failed to initialize Terraform: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
}

export const terraformProvider = new TerraformProvider() as IProvider
