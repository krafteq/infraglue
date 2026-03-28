import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { GitLabPipelineTrigger } from './ci-triggers/gitlab/trigger.js'
import { getConfig, getTriggerToken, loadConfig } from './config.js'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { BridgeError } from './errors.js'
import { GitLabWebhookHandler } from './git-hosts/gitlab/webhook-handler.js'
import { logger } from './logger.js'
import { healthRoute } from './routes/health.js'
import { createWebhookRoute } from './routes/webhook.js'

function createApp() {
  const config = getConfig()

  const gitHost = new GitLabWebhookHandler({
    webhookSecret: config.GITLAB_WEBHOOK_SECRET,
    approvalEmoji: config.APPROVAL_EMOJI,
    accessToken: config.GITLAB_ACCESS_TOKEN,
  })

  const app = new Hono()

  app.onError((err, c) => {
    if (err instanceof BridgeError) {
      logger.error(`${err.name}: ${err.message}`)
      return c.json({ error: err.message }, err.statusCode as ContentfulStatusCode)
    }
    logger.error(`Unexpected error: ${err.message}`)
    return c.json({ error: 'Internal server error' }, 500)
  })

  app.route('/', healthRoute)
  app.route(
    '/',
    createWebhookRoute({
      gitHost,
      createCiTrigger: (event) => new GitLabPipelineTrigger(event.apiBaseUrl, getTriggerToken),
    }),
  )

  return app
}

function main() {
  try {
    loadConfig()
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }

  const config = getConfig()
  const app = createApp()

  const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    logger.info(`InfraGlue Bridge listening on port ${info.port}`)
  })

  const shutdown = () => {
    logger.info('Shutting down...')
    server.close(() => {
      process.exit(0)
    })
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main()
