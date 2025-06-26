import { Provider, type PlatformDetectionResult } from '@infra-glue/provider-core'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

type ProviderOutput = Record<string, string>
type ProviderInput = Record<string, string>

interface ProviderPlan {
  text: string
  output: ProviderOutput
}

type TerraformPlanOutput =
  | {
      type: 'planned_change'
      change: {
        resource: Record<string, string>
        // TODO: add other fields
      }
    }
  | {
      type: 'outputs'
      outputs: Record<string, { action: 'create' } | { value: string }>
    }
  | Record<string, unknown>

type TerraformOutputOutput = Record<string, { value: string }>

export class TerraformProvider extends Provider {
  constructor() {
    super()
  }

  getProviderName(): string {
    return 'terraform'
  }

  async getPlan(configuration: PlatformDetectionResult, input: ProviderInput): Promise<ProviderPlan> {
    try {
      await this.checkTerraformInstallation()

      await this.initializeTerraform(configuration)

      const variables = Object.entries(input)
        .map(([key, value]) => `-var "${key}=${value}"`)
        .join(' ')

      const { stdout } = await execAsync(`terraform plan --json ${variables}`, {
        cwd: configuration.rootPath,
      })

      const parsedResults = JSON.parse(`[${stdout.trimEnd().replace(/\n/g, ',')}]`) as TerraformPlanOutput[]
      const outputs = parsedResults.filter((result) => result.type === 'outputs')

      // TODO: fix the types
      return {
        text: stdout,
        output: outputs.reduce((acc, result) => {
          if (result.type === 'outputs') {
            return {
              ...acc,
              // TODO: why it cannot determine the type of the value?
              ...Object.fromEntries(
                Object.entries(result.outputs as Record<string, { value: string }>).map(([key, value]) => [
                  key,
                  // TODO: it is the most interesting challenge, we don't have the real value here,
                  // so for generating the plan of dependent projects, we need to create a fake one??? maybe I just missed something???
                  value.value || 'TO_BE_DEFINED',
                ]),
              ),
            }
          }
          return acc
        }, {} as ProviderOutput) as ProviderOutput,
      }
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string }
        throw new Error(
          `Terraform plan failed: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}`,
        )
      }
      throw error
    }
  }

  async apply(configuration: PlatformDetectionResult, input: ProviderInput): Promise<ProviderOutput> {
    try {
      await this.checkTerraformInstallation()

      await this.initializeTerraform(configuration)

      const variables = Object.entries(input)
        .map(([key, value]) => `-var "${key}=${value}"`)
        .join(' ')

      await execAsync(`terraform apply --auto-approve --json ${variables}`, {
        cwd: configuration.rootPath,
      })

      const { stdout: outputStdout } = await execAsync(`terraform output --json`, {
        cwd: configuration.rootPath,
      })

      const outputs = JSON.parse(outputStdout) as TerraformOutputOutput

      return Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, value.value]))
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string }
        throw new Error(
          `Terraform apply failed: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}`,
        )
      }
      throw error
    }
  }

  private async checkTerraformInstallation(): Promise<void> {
    try {
      await execAsync('terraform version')
    } catch {
      throw new Error('Terraform is not installed or not available in PATH')
    }
  }

  private async initializeTerraform(configuration: PlatformDetectionResult): Promise<void> {
    try {
      await execAsync('terraform init', { cwd: configuration.rootPath })
    } catch (error) {
      throw new Error(`Failed to initialize Terraform: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
