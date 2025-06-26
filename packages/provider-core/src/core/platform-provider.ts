import type { PlatformDetectionResult } from './platform-detector.js'
import { Provider, type ProviderOutput, type ProviderInput, type ProviderPlan } from './provider.js'
import importFrom from 'import-from'

export async function getProvider(configuration: PlatformDetectionResult, rootPath?: string): Promise<Provider> {
  const providerName = configuration.provider
  const resolvedRootPath = rootPath ?? configuration.rootPath
  if (providerName === 'platform') {
    return new PlatformProvider()
  }
  const providerPackageName = `@infra-glue/provider-${providerName}`
  const providerModule = (await importFrom(resolvedRootPath, providerPackageName)) as { default: new () => Provider }
  if (typeof providerModule.default !== 'function') {
    throw new Error(`Provider ${providerName} from ${providerPackageName} is not a function`)
  }
  const result = new providerModule.default()
  if (!(result instanceof Provider)) {
    throw new Error(`Provider ${providerName} from ${providerPackageName} is not a subclass of Provider`)
  }
  if (result.getProviderName() !== providerName) {
    throw new Error(`Provider ${providerName} from ${providerPackageName} has a different name`)
  }
  return result
}

export class PlatformProvider extends Provider {
  override getProviderName(): string {
    return 'platform'
  }

  override async getPlan(
    configuration: PlatformDetectionResult,
    input: ProviderInput,
    rootPath?: string,
  ): Promise<ProviderPlan> {
    const planCache = new Map<string, ProviderPlan>()
    const resolvedRootPath = rootPath ?? configuration.rootPath

    for (const workspaceKey in configuration.workspaces) {
      const workspace = configuration.workspaces[workspaceKey]
      const inputs: ProviderInput = {}
      for (const injectionKey in workspace.injections) {
        const injection = workspace.injections[injectionKey]
        const valueToInject = injection.workspace
          ? planCache.get(injection.workspace)?.output[injection.key]
          : input[injection.key]
        if (valueToInject === undefined) {
          throw new Error(`Value to inject ${injection.key} from workspace ${injection.workspace} is not found`)
        }
        inputs[injection.key] = valueToInject
      }

      const provider = await getProvider(workspace, resolvedRootPath)
      const plan =
        provider instanceof PlatformProvider
          ? await provider.getPlan(workspace, inputs, resolvedRootPath)
          : await provider.getPlan(workspace, inputs)
      planCache.set(workspaceKey, plan)
    }
    const result: ProviderPlan = {
      text: '',
      output: {},
    }
    for (const outputKey in configuration.output) {
      const output = configuration.output[outputKey]
      const valueToOutput = output.workspace ? planCache.get(output.workspace)?.output[output.key] : input[output.key]
      if (valueToOutput === undefined) {
        // throw new Error(`Value to output ${output.key} from workspace ${output.workspace} is not found`)
      }
      result.output[outputKey] = valueToOutput ?? 'TO_BE_DEFINED'
    }
    result.text = Array.from(planCache.entries())
      .map(([workspaceKey, plan]) => `${workspaceKey}:\n${plan.text}`)
      .join('\n\n')
    return result
  }

  override async apply(
    configuration: PlatformDetectionResult,
    input: ProviderInput,
    rootPath?: string,
  ): Promise<ProviderOutput> {
    const outputsCache = new Map<string, ProviderOutput>()
    const resolvedRootPath = rootPath ?? configuration.rootPath

    for (const workspaceKey in configuration.workspaces) {
      const workspace = configuration.workspaces[workspaceKey]
      const inputs: ProviderInput = {}
      for (const injectionKey in workspace.injections) {
        const injection = workspace.injections[injectionKey]
        const valueToInject = injection.workspace
          ? outputsCache.get(injection.workspace)?.[injection.key]
          : input[injection.key]
        if (valueToInject === undefined) {
          throw new Error(`Value to inject ${injection.key} from workspace ${injection.workspace} is not found`)
        }
        inputs[injection.key] = valueToInject
      }
      const provider = await getProvider(workspace, resolvedRootPath)
      const outputs =
        provider instanceof PlatformProvider
          ? await provider.apply(workspace, inputs, resolvedRootPath)
          : await provider.apply(workspace, inputs)
      outputsCache.set(workspaceKey, outputs)
    }
    const result: ProviderOutput = {}
    for (const outputKey in configuration.output) {
      const output = configuration.output[outputKey]
      const valueToOutput = output.workspace ? outputsCache.get(output.workspace)?.[output.key] : input[output.key]
      if (valueToOutput === undefined) {
        throw new Error(`Value to output ${output.key} from workspace ${output.workspace} is not found`)
      }
      result[outputKey] = valueToOutput
    }
    return result
  }
}
