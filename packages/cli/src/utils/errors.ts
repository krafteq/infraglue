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
  constructor(
    message: string,
    public readonly provider: string,
    public readonly workspace: string,
  ) {
    super(message, 3)
    this.name = 'ProviderError'
  }
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
