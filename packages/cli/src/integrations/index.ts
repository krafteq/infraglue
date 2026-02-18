import { CLI_INTEGRATION } from './cli-integration.js'
import type { IIntegration } from './integration.js'
import { NO_TTY_CLI_INTEGRATION } from './no-tty-cli-integration.js'
import { UserError } from '../utils/index.js'

export function getIntegration(name: string = 'cli'): IIntegration {
  switch (name) {
    case 'cli':
      return CLI_INTEGRATION
    case 'no-tty-cli':
      return NO_TTY_CLI_INTEGRATION
    case 'gitlab':
      throw new UserError(
        'GitLab integration is not implemented yet. Use --integration cli or --integration no-tty-cli.',
      )
    default:
      throw new UserError(`Unknown integration '${name}'. Available: cli, no-tty-cli.`)
  }
}
