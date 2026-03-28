export class BridgeError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
  ) {
    super(message)
    this.name = 'BridgeError'
  }
}

export class WebhookValidationError extends BridgeError {
  constructor(message: string) {
    super(message, 401)
    this.name = 'WebhookValidationError'
  }
}

export class GitHostApiError extends BridgeError {
  constructor(
    message: string,
    public readonly upstream: { status: number; body?: string },
  ) {
    super(message, 502)
    this.name = 'GitHostApiError'
  }
}

export class TriggerError extends BridgeError {
  constructor(
    message: string,
    public readonly upstream: { status: number; body?: string },
  ) {
    super(message, 502)
    this.name = 'TriggerError'
  }
}

export class ConfigError extends BridgeError {
  constructor(message: string) {
    super(message, 500)
    this.name = 'ConfigError'
  }
}
