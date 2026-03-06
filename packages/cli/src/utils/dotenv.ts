import { readFile } from 'fs/promises'
import { join } from 'path'
import { logger } from './logger.js'
import { UserError } from './errors.js'

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Parse dotenv file content into key-value pairs.
 * Supports KEY=VALUE, KEY="quoted", KEY='single quoted', # comments,
 * blank lines, and `export KEY=VALUE` prefix.
 */
export function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // Strip optional `export ` prefix
    const assignment = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed

    const eqIndex = assignment.indexOf('=')
    if (eqIndex === -1) continue

    const key = assignment.slice(0, eqIndex).trim()
    if (UNSAFE_KEYS.has(key)) continue

    let value = assignment.slice(eqIndex + 1)

    // Handle quoted values
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    result[key] = value
  }

  return result
}

/**
 * Load .ig/.env and optionally .ig/.env.{envName} into process.env.
 * Merge order: .ig/.env overrides process.env, .ig/.env.{envName} overrides both.
 * Missing files are silently ignored.
 */
export async function loadDotEnvFiles(rootPath: string, envName?: string): Promise<void> {
  await loadSingleDotEnv(join(rootPath, '.ig', '.env'))
  if (envName) {
    if (envName.includes('/') || envName.includes('\\') || envName.includes('..')) {
      throw new UserError(`Invalid environment name '${envName}': must not contain path separators`)
    }
    await loadSingleDotEnv(join(rootPath, '.ig', `.env.${envName}`))
  }
}

async function loadSingleDotEnv(filePath: string): Promise<void> {
  try {
    const content = await readFile(filePath, 'utf-8')
    const vars = parseDotEnv(content)
    const count = Object.keys(vars).length
    if (count > 0) {
      Object.assign(process.env, vars)
      logger.debug(`Loaded ${count} variable(s) from ${filePath}`)
    }
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return // silently ignore missing files
    }
    throw error
  }
}
