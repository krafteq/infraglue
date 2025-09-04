export type IIntegration =
  | {
      interactive: true
      askForConfirmation: (message: string) => Promise<boolean>
    }
  | {
      interactive: false
      askForConfirmation: (message: string) => Promise<void>
    }
