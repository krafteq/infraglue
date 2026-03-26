import { GitHostApiError } from '../../errors.js'
import { logger } from '../../logger.js'
import type { GitLabNote } from './types.js'

export class GitLabApiClient {
  constructor(private readonly accessToken: string) {}

  /**
   * Fetch the body of a merge request note (comment).
   */
  async fetchNoteBody(apiBaseUrl: string, projectId: string, mergeRequestIid: string, noteId: number): Promise<string> {
    const url = `${apiBaseUrl}/projects/${projectId}/merge_requests/${mergeRequestIid}/notes/${noteId}`
    logger.debug(`Fetching note: ${url}`)

    const response = await fetch(url, {
      headers: {
        'PRIVATE-TOKEN': this.accessToken,
      },
    })

    if (!response.ok) {
      const body = await response.text()
      throw new GitHostApiError(`Failed to fetch note ${noteId}: HTTP ${response.status}`, {
        status: response.status,
        body,
      })
    }

    const note = (await response.json()) as GitLabNote
    return note.body
  }
}
