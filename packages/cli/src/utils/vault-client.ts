import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { UserError } from './errors.js'
import { logger } from './logger.js'

export interface VaultClientOptions {
  role?: string | undefined
  env?: Record<string, string | undefined>
}

export class VaultClient {
  private readonly address: string
  private readonly role: string | undefined
  private readonly env: Record<string, string | undefined>
  private readonly cache = new Map<string, Record<string, unknown>>()
  private tokenPromise: Promise<string> | null = null

  constructor(address: string, options?: VaultClientOptions) {
    this.address = address.replace(/\/+$/, '')
    this.role = options?.role
    this.env = options?.env ?? process.env
  }

  async getSecret(path: string, field: string): Promise<string> {
    logger.debug(`[vault] reading ${path}#${field}...`)
    const data = await this.fetchSecret(path)
    const value = data[field]
    if (value === undefined) {
      throw new UserError(
        `Vault secret at '${path}' does not contain field '${field}'. Available fields: ${Object.keys(data).join(', ')}`,
      )
    }
    if (typeof value !== 'string') {
      throw new UserError(`Vault secret field '${field}' at '${path}' is not a string`)
    }
    logger.debug(`[vault] reading ${path}#${field}... OK`)
    return value
  }

  private async fetchSecret(path: string): Promise<Record<string, unknown>> {
    const cached = this.cache.get(path)
    if (cached) return cached

    const token = await this.resolveToken()
    const url = `${this.address}/v1/${path}`

    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          'X-Vault-Token': token,
        },
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      throw new UserError(`Cannot connect to Vault at ${this.address}: ${msg}`)
    }

    if (response.status === 403) {
      throw new UserError(`Vault access denied for path '${path}'. Check your token permissions`)
    }
    if (response.status === 404) {
      throw new UserError(`Vault secret not found at '${path}'`)
    }
    if (!response.ok) {
      throw new UserError(`Vault request failed for '${path}': HTTP ${response.status}`)
    }

    const body = (await response.json()) as { data?: { data?: Record<string, unknown> } }
    const data = body?.data?.data
    if (!data || typeof data !== 'object') {
      throw new UserError(`Vault response at '${path}' has unexpected format (expected KV v2 secret)`)
    }

    this.cache.set(path, data)
    return data
  }

  private resolveToken(): Promise<string> {
    if (!this.tokenPromise) {
      this.tokenPromise = this.doResolveToken()
    }
    return this.tokenPromise
  }

  private async doResolveToken(): Promise<string> {
    // Priority 1: VAULT_TOKEN env var
    const envToken = this.env['VAULT_TOKEN']
    if (envToken) {
      logger.debug('[vault] authenticated via VAULT_TOKEN env var')
      return envToken
    }

    // Priority 2: ~/.vault-token file
    try {
      const tokenFile = join(homedir(), '.vault-token')
      const token = (await readFile(tokenFile, 'utf-8')).trim()
      if (token) {
        logger.debug('[vault] authenticated via ~/.vault-token')
        return token
      }
    } catch {
      // file doesn't exist or is unreadable, try next method
    }

    // Priority 3: JWT auth via VAULT_ID_TOKEN
    const jwt = this.env['VAULT_ID_TOKEN']
    if (jwt) {
      logger.debug('[vault] authenticating via JWT (VAULT_ID_TOKEN)...')
      const token = await this.authenticateJwt(jwt)
      logger.debug('[vault] JWT authentication OK')
      return token
    }

    throw new UserError(
      'Vault authentication failed: no token found. Set VAULT_TOKEN, run `vault login`, or set VAULT_ID_TOKEN for JWT auth',
    )
  }

  private async authenticateJwt(jwt: string): Promise<string> {
    const role = this.role ?? this.env['VAULT_ROLE'] ?? this.env['VAULT_AUTH_ROLE']
    if (!role) {
      throw new UserError(
        "Vault JWT auth requires a role. Set 'role' in vault config or VAULT_ROLE environment variable",
      )
    }

    const mount = this.env['VAULT_AUTH_MOUNT'] ?? this.env['VAULT_AUTH_PATH'] ?? 'jwt'
    const url = `${this.address}/v1/auth/${mount}/login`

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, jwt }),
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      throw new UserError(`Vault JWT authentication failed: cannot connect to ${this.address}: ${msg}`)
    }

    if (!response.ok) {
      const body = await response.text()
      throw new UserError(`Vault JWT authentication failed (HTTP ${response.status}): ${body}`)
    }

    const data = (await response.json()) as { auth?: { client_token?: string } }
    const token = data?.auth?.client_token
    if (!token) {
      throw new UserError('Vault JWT authentication response missing client_token')
    }

    return token
  }
}
