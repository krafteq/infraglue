import type { IIntegration } from './integration.js'

export const CLI_INTEGRATION: IIntegration = {
  interactive: true,
  askForConfirmation: async (message: string) => {
    process.stdout.write(message + '  y/n\n')
    const answer = await new Promise<string>((resolve) => {
      process.stdin.resume()
      process.stdin.setEncoding('utf8')
      process.stdin.once('data', (data) => {
        process.stdin.pause()
        resolve(data.toString().trim())
      })
    })
    // TODO: npm inquirer?
    return answer === 'y'
  },
}
