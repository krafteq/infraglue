import { DefaultFormatter } from '../formatters/default-formatter.js'
import type { ProviderPlan } from '../providers/provider-plan.js'
import { logger } from '../utils/logger.js'

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

  private get headers(): Record<string, string> {
    return {
      'PRIVATE-TOKEN': GitLabPipeline.getAccessToken() || '',
      'Content-Type': 'application/json',
    }
  }

  /**
   * Add a comment to a merge request
   */
  async addComment(content: string) {
    const response = await fetch(`${this.mergeRequestUrl}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body: content }),
      headers: this.headers,
    })

    if (!response.ok) {
      logger.error(`Failed to add comment to merge request: ${response.status} ${response.statusText}`)
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
  }

  /**
   * List all notes on the merge request (sorted ascending by creation).
   */
  async listNotes(): Promise<GitLabNote[]> {
    const allNotes: GitLabNote[] = []
    let page = 1

    while (true) {
      const url = `${this.mergeRequestUrl}/notes?sort=asc&per_page=100&page=${page}`
      const response = await fetch(url, { headers: this.headers })

      if (!response.ok) {
        throw new Error(`Failed to list MR notes: HTTP ${response.status}`)
      }

      const notes = (await response.json()) as GitLabNote[]
      allNotes.push(...notes.filter((n) => !n.system))

      const nextPage = response.headers.get('x-next-page')
      if (!nextPage) break
      page = parseInt(nextPage, 10)
    }

    return allNotes
  }

  /**
   * List award emojis on a specific MR note.
   */
  async listNoteAwardEmojis(noteId: number): Promise<GitLabAwardEmoji[]> {
    const url = `${this.mergeRequestUrl}/notes/${noteId}/award_emoji`
    const response = await fetch(url, { headers: this.headers })

    if (!response.ok) {
      throw new Error(`Failed to list note emojis: HTTP ${response.status}`)
    }

    return (await response.json()) as GitLabAwardEmoji[]
  }

  /**
   * Edit a merge request note body.
   */
  async editNote(noteId: number, newBody: string) {
    const url = `${this.mergeRequestUrl}/notes/${noteId}`
    const response = await fetch(url, {
      method: 'PUT',
      body: JSON.stringify({ body: newBody }),
      headers: this.headers,
    })

    if (!response.ok) {
      throw new Error(`Failed to edit note ${noteId}: HTTP ${response.status}`)
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
    return process.env['CI_MERGE_REQUEST_IID'] || null
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
      logger.error(
        `Missing required GitLab environment variables: CI_MERGE_REQUEST_PROJECT_ID=${projectId}, CI_MERGE_REQUEST_IID=${mergeRequestIid}, CI_API_V4_URL=${apiUrl}`,
      )

      return null
    }

    return `${apiUrl}/projects/${projectId}/merge_requests/${mergeRequestIid}`
  }

  static getCommitSha(): string | null {
    return process.env['CI_COMMIT_SHA'] || null
  }

  static getAccessToken(): string | null {
    return process.env['GITLAB_ACCESS_TOKEN'] || process.env['CI_JOB_TOKEN'] || null
  }
}

export interface GitLabNote {
  id: number
  body: string
  system: boolean
  updated_at: string
}

export interface GitLabAwardEmoji {
  id: number
  name: string
  user: { username: string }
}

export interface LevelCommentData {
  levelNumber: number
  levelsCount: number
  workspacePlans: Array<{ workspaceName: string; plan: ProviderPlan }>
  planId: string
  commitSha?: string | undefined
}

/**
 * Format an MR comment for a single execution level.
 * Includes formatted plan per workspace, approval hint, and ig-meta tag.
 */
export function formatLevelComment(data: LevelCommentData): string {
  const header = `## InfraGlue Plan — Level ${data.levelNumber}/${data.levelsCount}\n\n`

  const body = data.workspacePlans
    .map(({ workspaceName, plan }) => {
      const formatted = DefaultFormatter.formatForMarkdown(plan)
      return formatted ? `### ${workspaceName}\n${formatted}` : ''
    })
    .filter(Boolean)
    .join('\n\n')

  const workspaceNames = data.workspacePlans.map((wp) => wp.workspaceName)
  const metaObj: Record<string, unknown> = {
    level: data.levelNumber,
    workspaces: workspaceNames,
    planId: data.planId,
  }
  if (data.commitSha) metaObj['commitSha'] = data.commitSha
  const metadata = `<!-- ig-meta:${JSON.stringify(metaObj)} -->`

  const approvalHint = '\n\n> React with :thumbsup: to approve this level.\n'

  return `${header}${body}${approvalHint}\n${metadata}`
}
