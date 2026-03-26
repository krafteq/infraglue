import { z } from 'zod'
import { ConfigError } from './errors.js'
import { logger } from './logger.js'

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),

  GITLAB_WEBHOOK_SECRET: z.string().min(1, 'GITLAB_WEBHOOK_SECRET is required'),
  GITLAB_ACCESS_TOKEN: z.string().min(1, 'GITLAB_ACCESS_TOKEN is required'),
  GITLAB_TRIGGER_TOKEN: z.string().min(1, 'GITLAB_TRIGGER_TOKEN is required'),

  APPROVAL_EMOJI: z.string().default('thumbsup'),
})

export type Config = z.infer<typeof configSchema>

let _config: Config | null = null

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = configSchema.safeParse(env)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new ConfigError(`Invalid configuration:\n${issues}`)
  }
  _config = result.data
  logger.setLevel(_config.LOG_LEVEL)
  return _config
}

export function getConfig(): Config {
  if (!_config) {
    throw new ConfigError('Configuration not loaded. Call loadConfig() first.')
  }
  return _config
}

/**
 * Get the pipeline trigger token for a specific project.
 * Falls back to the global GITLAB_TRIGGER_TOKEN if no project-specific token is set.
 */
export function getTriggerToken(projectId: string): string {
  const projectSpecific = process.env[`GITLAB_TRIGGER_TOKEN_${projectId}`]
  if (projectSpecific) return projectSpecific
  return getConfig().GITLAB_TRIGGER_TOKEN
}
