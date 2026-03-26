/**
 * GitLab emoji webhook payload.
 * See: https://docs.gitlab.com/user/project/integrations/webhook_events/#emoji-events
 */
export interface GitLabEmojiWebhookPayload {
  object_kind: string
  event_type: string
  user: {
    username: string
    name: string
  }
  project: {
    id: number
    path_with_namespace: string
    web_url: string
  }
  object_attributes: {
    action: string
    name: string
    awardable_type: string
    awardable_id: number
  }
  merge_request: {
    iid: number
    source_branch: string
    target_branch: string
    title: string
    state: string
  }
}

/**
 * GitLab note (comment) from the API.
 * See: https://docs.gitlab.com/api/notes/#get-single-merge-request-note
 */
export interface GitLabNote {
  id: number
  body: string
  author: {
    username: string
  }
}
