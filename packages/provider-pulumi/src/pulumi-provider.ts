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

type PulumiPreviewOutput = {
  steps: Array<{
    op: string
    urn: string
    resource?: {
      type: string
      properties?: Record<string, unknown>
    }
  }>
  outputs?: Record<string, unknown>
}

type PulumiStackOutput = Record<string, { value: unknown }>

export class PulumiProvider extends Provider {
  constructor() {
    super()
  }

  getProviderName(): string {
    return 'pulumi'
  }

  async getPlan(configuration: PlatformDetectionResult, input: ProviderInput): Promise<ProviderPlan> {
    try {
      await this.checkPulumiInstallation()

      await this.initializePulumi(configuration)

      // Set Pulumi configuration values from input
      await this.setPulumiConfig(configuration, input)

      const { stdout } = await execAsync(`pulumi preview --json --diff`, {
        cwd: configuration.rootPath,
      })

      const previewResult = JSON.parse(stdout) as PulumiPreviewOutput

      // Extract outputs from the preview
      const outputs: ProviderOutput = {}
      if (previewResult.outputs) {
        for (const [key, value] of Object.entries(previewResult.outputs)) {
          outputs[key] = typeof value === 'string' ? value : JSON.stringify(value)
        }
      }

      return {
        text: stdout,
        output: outputs,
      }
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string }
        throw new Error(
          `Pulumi preview failed: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}`,
        )
      }
      throw error
    }
  }

  async apply(configuration: PlatformDetectionResult, input: ProviderInput): Promise<ProviderOutput> {
    try {
      await this.checkPulumiInstallation()

      await this.initializePulumi(configuration)

      // Set Pulumi configuration values from input
      await this.setPulumiConfig(configuration, input)

      await execAsync(`pulumi up --yes --json`, {
        cwd: configuration.rootPath,
      })

      const { stdout: outputStdout } = await execAsync(`pulumi stack output --json`, {
        cwd: configuration.rootPath,
      })

      const outputs = JSON.parse(outputStdout) as PulumiStackOutput

      return Object.fromEntries(
        Object.entries(outputs).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : JSON.stringify(value.value),
        ]),
      )
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: number; stderr?: string }
        throw new Error(`Pulumi up failed: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}`)
      }
      throw error
    }
  }

  private async checkPulumiInstallation(): Promise<void> {
    try {
      await execAsync('pulumi version')
    } catch {
      throw new Error('Pulumi is not installed or not available in PATH')
    }
  }

  private async initializePulumi(configuration: PlatformDetectionResult): Promise<void> {
    try {
      await execAsync('pulumi install', { cwd: configuration.rootPath })
      // Check if Pulumi project is already initialized
      try {
        await execAsync('pulumi stack ls', { cwd: configuration.rootPath })
      } catch {
        // If no stack exists, create a default one
        await execAsync('pulumi stack init dev', { cwd: configuration.rootPath })
      }
    } catch (error) {
      throw new Error(`Failed to initialize Pulumi: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private async setPulumiConfig(configuration: PlatformDetectionResult, input: ProviderInput): Promise<void> {
    try {
      // Set configuration values for the current stack
      for (const [key, value] of Object.entries(input)) {
        await execAsync(`pulumi config set ${key} ${value}`, {
          cwd: configuration.rootPath,
        })
      }
    } catch (error) {
      throw new Error(`Failed to set Pulumi config: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
