/**
 * Normalized approval event — git-host agnostic.
 * Produced by a GitHost implementation from a raw webhook payload.
 */
export interface ApprovalEvent {
  projectId: string
  mergeRequestIid: string
  noteId: number
  sourceBranch: string
  apiBaseUrl: string
  actor: string
}

/**
 * Interface for git host webhook handlers.
 * Each git host (GitLab, GitHub, etc.) implements this to normalize
 * its webhook payloads into ApprovalEvents.
 */
export interface GitHost {
  /**
   * Validate and parse a webhook request into an ApprovalEvent.
   * Returns null if the event is irrelevant (wrong emoji, wrong event type, etc.).
   * Throws WebhookValidationError if the request fails authentication.
   */
  parseWebhook(headers: Record<string, string>, body: unknown): ApprovalEvent | null

  /**
   * Fetch the body of a note/comment by its ID.
   */
  fetchNoteBody(event: ApprovalEvent): Promise<string>
}
