import type { IIntegration } from './integration.js'

export const NO_TTY_CLI_INTEGRATION: IIntegration = {
  interactive: false,
  askForConfirmation: async (message: string) => {
    console.log(message)
    console.log('If you want to proceed, run this command again with the --approve <level_index> flag')
  },
}
