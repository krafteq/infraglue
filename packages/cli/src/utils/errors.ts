import type { Diagnostic } from '../providers/provider-plan.js'

export class IgError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 1,
  ) {
    super(message)
    this.name = 'IgError'
  }
}

export class UserError extends IgError {
  constructor(message: string) {
    super(message, 2)
    this.name = 'UserError'
  }
}

export class ProviderError extends IgError {
  public readonly diagnostics: Diagnostic[]
  public readonly command: string | undefined

  constructor(
    message: string,
    public readonly provider: string,
    public readonly workspace: string,
    options?: { diagnostics?: Diagnostic[]; command?: string },
  ) {
    super(message, 3)
    this.name = 'ProviderError'
    this.diagnostics = options?.diagnostics ?? []
    this.command = options?.command
  }
}

export function formatProviderErrorMessage(
  providerName: string,
  workspace: string,
  diagnostics: Diagnostic[],
  command?: string,
): string {
  const lines: string[] = [`${providerName} command failed in ${workspace}`]

  const errors = diagnostics.filter((d) => d.severity === 'error')
  const toShow = errors.length > 0 ? errors : diagnostics

  if (toShow.length > 0) {
    for (const d of toShow) {
      const icon = d.severity === 'error' ? '\u2718' : d.severity === 'warning' ? '\u26A0' : '\u2139'
      const addr = d.address ? ` (${d.address})` : ''
      lines.push(`${icon} ${d.summary}${addr}`)
    }
  } else if (command) {
    lines.push(`Command: ${command}`)
  }

  lines.push('Run with -v for full provider output')
  return lines.join('\n')
}

export class ConfigError extends UserError {
  constructor(
    message: string,
    public readonly filePath: string,
  ) {
    super(`${filePath}: ${message}`)
    this.name = 'ConfigError'
  }
}

export const isDebug = () => process.env['IG_DEBUG'] === '1' || process.env['IG_VERBOSE'] === '1'

export function formatUnexpectedError(error: Error, version: string): string {
  return [
    'Unexpected internal error',
    '',
    'This is a bug in ig. Please report it at:',
    'https://github.com/krafteq/infraglue/issues/new',
    '',
    'Include the following:',
    `  ig version: ${version}`,
    `  Node.js: ${process.version}`,
    `  OS: ${process.platform} ${process.arch}`,
    '',
    isDebug() ? (error.stack ?? error.message) : error.message,
  ].join('\n')
}
