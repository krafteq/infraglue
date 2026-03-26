import { z } from 'zod'
import { WebhookValidationError } from '../../errors.js'
import { logger } from '../../logger.js'
import type { ApprovalEvent, GitHost } from '../types.js'
import { GitLabApiClient } from './client.js'
import type { GitLabEmojiWebhookPayload } from './types.js'

const emojiPayloadSchema = z.object({
  object_kind: z.literal('emoji'),
  event_type: z.literal('award'),
  user: z.object({
    username: z.string(),
    name: z.string(),
  }),
  project: z.object({
    id: z.number(),
    path_with_namespace: z.string(),
    web_url: z.string(),
  }),
  object_attributes: z.object({
    action: z.string(),
    name: z.string(),
    awardable_type: z.string(),
    awardable_id: z.number(),
  }),
  merge_request: z.object({
    iid: z.number(),
    source_branch: z.string(),
    target_branch: z.string(),
    title: z.string(),
    state: z.string(),
  }),
})

export interface GitLabWebhookHandlerOptions {
  webhookSecret: string
  approvalEmoji: string
  accessToken: string
}

export class GitLabWebhookHandler implements GitHost {
  private readonly client: GitLabApiClient

  constructor(private readonly options: GitLabWebhookHandlerOptions) {
    this.client = new GitLabApiClient(options.accessToken)
  }

  parseWebhook(headers: Record<string, string>, body: unknown): ApprovalEvent | null {
    this.validateToken(headers)

    const parsed = emojiPayloadSchema.safeParse(body)
    if (!parsed.success) {
      logger.debug(`Ignoring non-emoji webhook: ${parsed.error.issues.map((i) => i.message).join(', ')}`)
      return null
    }

    return this.extractApprovalEvent(parsed.data)
  }

  async fetchNoteBody(event: ApprovalEvent): Promise<string> {
    return this.client.fetchNoteBody(event.apiBaseUrl, event.projectId, event.mergeRequestIid, event.noteId)
  }

  private validateToken(headers: Record<string, string>): void {
    const token = headers['x-gitlab-token']
    if (token !== this.options.webhookSecret) {
      throw new WebhookValidationError('Invalid or missing X-Gitlab-Token')
    }
  }

  private extractApprovalEvent(payload: GitLabEmojiWebhookPayload): ApprovalEvent | null {
    const { object_attributes, merge_request, project, user } = payload

    if (object_attributes.action !== 'award') {
      logger.debug(`Ignoring emoji action: ${object_attributes.action}`)
      return null
    }

    if (object_attributes.name !== this.options.approvalEmoji) {
      logger.debug(`Ignoring emoji: ${object_attributes.name} (expected ${this.options.approvalEmoji})`)
      return null
    }

    if (object_attributes.awardable_type !== 'Note') {
      logger.debug(`Ignoring emoji on ${object_attributes.awardable_type} (expected Note)`)
      return null
    }

    if (merge_request.state !== 'opened') {
      logger.debug(`Ignoring emoji on closed MR (state: ${merge_request.state})`)
      return null
    }

    const apiBaseUrl = deriveApiBaseUrl(project.web_url)

    return {
      projectId: String(project.id),
      mergeRequestIid: String(merge_request.iid),
      noteId: object_attributes.awardable_id,
      sourceBranch: merge_request.source_branch,
      apiBaseUrl,
      actor: user.username,
    }
  }
}

/**
 * Derive the GitLab API v4 base URL from a project's web URL.
 * e.g., "https://gitlab.example.com/group/project" → "https://gitlab.example.com/api/v4"
 */
export function deriveApiBaseUrl(projectWebUrl: string): string {
  const url = new URL(projectWebUrl)
  return `${url.origin}/api/v4`
}
