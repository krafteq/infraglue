import { CLI_INTEGRATION } from './cli-integration.js'
import type { IIntegration } from './integration.js'
import { NO_TTY_CLI_INTEGRATION } from './no-tty-cli-integration.js'

export function getIntegration(name: string = 'cli'): IIntegration {
  switch (name) {
    case 'cli':
      return CLI_INTEGRATION
    case 'no-tty-cli':
      return NO_TTY_CLI_INTEGRATION
    case 'gitlab':
      throw new Error('Gitlab integration is not implemented yet')
    default:
      throw new Error(`Integration ${name} not found`)
  }
}
