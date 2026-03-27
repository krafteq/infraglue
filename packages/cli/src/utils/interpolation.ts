import { UserError } from './errors.js'
import type { VaultClient } from './vault-client.js'

/**
 * Interpolate `${VAR}` and `${vault:path#field}` references in a string.
 * Use `$${VAR}` to produce a literal `${VAR}` in the output (escape syntax).
 * Throws UserError if a referenced variable is not set or a vault secret cannot be resolved.
 */
export async function interpolateString(
  value: string,
  env: Record<string, string | undefined> = process.env,
  context?: string,
  vaultClient?: VaultClient,
): Promise<string> {
  let result = ''
  let i = 0

  while (i < value.length) {
    if (value[i] === '$') {
      // Check for escape: $${...} → literal ${...}
      if (value[i + 1] === '$' && value[i + 2] === '{') {
        const closeBrace = value.indexOf('}', i + 3)
        if (closeBrace !== -1) {
          result += value.slice(i + 1, closeBrace + 1)
          i = closeBrace + 1
          continue
        }
      }

      // Check for interpolation: ${VAR} or ${vault:path#field}
      if (value[i + 1] === '{') {
        const closeBrace = value.indexOf('}', i + 2)
        if (closeBrace !== -1) {
          const varName = value.slice(i + 2, closeBrace)

          if (varName.startsWith('vault:')) {
            const ref = varName.slice('vault:'.length)
            const hashIndex = ref.indexOf('#')
            if (hashIndex === -1) {
              const ctx = context ? ` (in ${context})` : ''
              throw new UserError(
                `Invalid vault reference '\${${varName}}': expected format \${vault:path#field}${ctx}`,
              )
            }
            const path = ref.slice(0, hashIndex)
            const field = ref.slice(hashIndex + 1)
            if (!path || !field) {
              const ctx = context ? ` (in ${context})` : ''
              throw new UserError(`Invalid vault reference '\${${varName}}': path and field must not be empty${ctx}`)
            }
            if (!vaultClient) {
              const ctx = context ? ` (in ${context})` : ''
              throw new UserError(
                `Vault reference '\${${varName}}' found but no vault configuration provided${ctx}. Set VAULT_ADDR or add vault.address to root ig.yaml`,
              )
            }
            try {
              result += await vaultClient.getSecret(path, field)
            } catch (error) {
              if (error instanceof UserError) {
                const ctx = context ? ` (in ${context})` : ''
                throw new UserError(`${error.message}${ctx}`)
              }
              throw error
            }
          } else {
            const varValue = env[varName]
            if (varValue === undefined) {
              const ctx = context ? ` (in ${context})` : ''
              throw new UserError(`Environment variable '${varName}' is not set${ctx}`)
            }
            result += varValue
          }

          i = closeBrace + 1
          continue
        }
      }
    }

    result += value[i]
    i++
  }

  return result
}

/**
 * Recursively interpolate all string values in a config structure.
 * Handles strings, arrays of strings, and Record<string, string> objects.
 * Non-string values pass through unchanged.
 */
export async function interpolateConfig<T>(
  value: T,
  env: Record<string, string | undefined> = process.env,
  context?: string,
  vaultClient?: VaultClient,
): Promise<T> {
  if (typeof value === 'string') {
    return (await interpolateString(value, env, context, vaultClient)) as T
  }

  if (Array.isArray(value)) {
    const results = []
    for (const item of value) {
      results.push(await interpolateConfig(item, env, context, vaultClient))
    }
    return results as T
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      result[k] = await interpolateConfig(v, env, context, vaultClient)
    }
    return result as T
  }

  return value
}
