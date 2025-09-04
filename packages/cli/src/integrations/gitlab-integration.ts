// TODO: refactor this.

/**
 * GitLab API client for interacting with GitLab merge requests
 */
export class GitLabClient {
  private mergeRequestUrl: string

  constructor(mergeRequestUrl?: string) {
    if (!mergeRequestUrl && !GitLabPipeline.isInPipeline()) {
      throw new Error('Not running in GitLab CI/CD pipeline')
    }
    this.mergeRequestUrl = mergeRequestUrl || GitLabPipeline.getMergeRequestUrl() || ''
    if (!this.mergeRequestUrl) {
      throw new Error('No merge request URL found')
    }
  }

  /**
   * Add a comment to a merge request
   */
  async addComment(content: string) {
    try {
      const response = await fetch(`${this.mergeRequestUrl}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body: content }),
        headers: {
          'PRIVATE-TOKEN': GitLabPipeline.getAccessToken() || '',
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`Failed to add comment to merge request: ${response.status} ${response.statusText}`)
        console.error(`Response body: ${errorText}`)
        console.error(`Merge request URL: ${this.mergeRequestUrl}`)
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
    } catch (error) {
      console.error('Error adding comment to merge request:', error)
      throw error
    }
  }
}

/**
 * GitLab CI/CD pipeline utilities
 */
export class GitLabPipeline {
  /**
   * Check if running in GitLab CI/CD pipeline
   */
  static isInPipeline(): boolean {
    return process.env['GITLAB_CI'] === 'true'
  }

  /**
   * Get merge request IID from pipeline environment variables
   */
  static getMergeRequestIid(): string | null {
    // GITLAB_MERGE_REQUEST_IID is available in merge request pipelines
    return process.env['GITLAB_MERGE_REQUEST_IID'] || null
  }

  /**
   * Get project ID from pipeline environment variables
   */
  static getProjectId(): string | null {
    return process.env['CI_PROJECT_ID'] || null
  }

  /**
   * Get project path from pipeline environment variables
   */
  static getProjectPath(): string | null {
    return process.env['CI_PROJECT_PATH'] || null
  }

  /**
   * Get current branch from pipeline environment variables
   */
  static getCurrentBranch(): string | null {
    return process.env['CI_COMMIT_REF_NAME'] || null
  }

  /**
   * Get target branch from pipeline environment variables
   */
  static getTargetBranch(): string | null {
    return process.env['CI_MERGE_REQUEST_TARGET_BRANCH_NAME'] || null
  }

  /**
   * Get merge request title from pipeline environment variables
   */
  static getMergeRequestTitle(): string | null {
    return process.env['CI_MERGE_REQUEST_TITLE'] || null
  }

  /**
   * Get merge request URL from pipeline environment variables
   */
  static getMergeRequestUrl(): string | null {
    const projectId = process.env['CI_MERGE_REQUEST_PROJECT_ID']
    const mergeRequestIid = process.env['CI_MERGE_REQUEST_IID']
    const apiUrl = process.env['CI_API_V4_URL']

    if (!projectId || !mergeRequestIid || !apiUrl) {
      console.log(
        `Missing required GitLab environment variables: CI_MERGE_REQUEST_PROJECT_ID=${projectId}, CI_MERGE_REQUEST_IID=${mergeRequestIid}, CI_API_V4_URL=${apiUrl}`,
      )

      return null
    }

    return `${apiUrl}/projects/${projectId}/merge_requests/${mergeRequestIid}`
  }

  static getAccessToken(): string | null {
    return process.env['GITLAB_ACCESS_TOKEN'] || process.env['CI_JOB_TOKEN'] || null
  }
}
