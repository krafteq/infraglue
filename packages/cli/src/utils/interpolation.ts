import { UserError } from './errors.js'

/**
 * Interpolate `${VAR}` references in a string with values from environment variables.
 * Use `$${VAR}` to produce a literal `${VAR}` in the output (escape syntax).
 * Throws UserError if a referenced variable is not set.
 */
export function interpolateString(
  value: string,
  env: Record<string, string | undefined> = process.env,
  context?: string,
): string {
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

      // Check for interpolation: ${VAR}
      if (value[i + 1] === '{') {
        const closeBrace = value.indexOf('}', i + 2)
        if (closeBrace !== -1) {
          const varName = value.slice(i + 2, closeBrace)
          const varValue = env[varName]
          if (varValue === undefined) {
            const ctx = context ? ` (in ${context})` : ''
            throw new UserError(`Environment variable '${varName}' is not set${ctx}`)
          }
          result += varValue
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
export function interpolateConfig<T>(
  value: T,
  env: Record<string, string | undefined> = process.env,
  context?: string,
): T {
  if (typeof value === 'string') {
    return interpolateString(value, env, context) as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateConfig(item, env, context)) as T
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      result[k] = interpolateConfig(v, env, context)
    }
    return result as T
  }

  return value
}
