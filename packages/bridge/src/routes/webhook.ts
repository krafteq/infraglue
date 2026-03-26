import { Hono } from 'hono'
import type { CiTrigger } from '../ci-triggers/types.js'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { BridgeError } from '../errors.js'
import type { ApprovalEvent, GitHost } from '../git-hosts/types.js'
import { logger } from '../logger.js'
import { parseMetadata } from '../metadata.js'

export interface WebhookRouteDeps {
  gitHost: GitHost
  createCiTrigger: (event: ApprovalEvent) => CiTrigger
}

export function createWebhookRoute(deps: WebhookRouteDeps): Hono {
  const app = new Hono()

  app.post('/webhooks/gitlab', async (c) => {
    const headers: Record<string, string> = {}
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value
    })

    const body = await c.req.json()

    const event = deps.gitHost.parseWebhook(headers, body)
    if (!event) {
      return c.json({ ignored: true, reason: 'irrelevant event' })
    }

    logger.info(
      `Approval event: project=${event.projectId} MR=!${event.mergeRequestIid} note=${event.noteId} by=${event.actor}`,
    )

    const noteBody = await deps.gitHost.fetchNoteBody(event)
    const metadata = parseMetadata(noteBody)
    if (!metadata) {
      logger.info(`Note ${event.noteId} has no ig metadata, ignoring`)
      return c.json({ ignored: true, reason: 'no ig metadata in note' })
    }

    logger.info(
      `Triggering apply: level=${metadata.level} workspaces=[${metadata.workspaces.join(',')}] planId=${metadata.planId}`,
    )

    const ciTrigger = deps.createCiTrigger(event)
    const result = await ciTrigger.trigger(event.projectId, event.sourceBranch, {
      IG_ACTION: 'apply',
      IG_APPROVED_LEVEL: String(metadata.level),
      IG_PLAN_ID: metadata.planId,
      IG_MR_IID: event.mergeRequestIid,
    })

    return c.json({
      triggered: true,
      pipelineId: result.pipelineId,
      webUrl: result.webUrl,
      level: metadata.level,
      workspaces: metadata.workspaces,
    })
  })

  return app
}

export function createErrorHandler() {
  return (err: Error, c: { json: (data: unknown, status: ContentfulStatusCode) => Response }) => {
    if (err instanceof BridgeError) {
      logger.error(`${err.name}: ${err.message}`)
      return c.json({ error: err.message }, err.statusCode as ContentfulStatusCode)
    }

    logger.error(`Unexpected error: ${err.message}`)
    return c.json({ error: 'Internal server error' }, 500)
  }
}
