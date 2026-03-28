import type { ExecutionContext } from '../core/model.js'
import { MultistageExecutor, type LevelPlanReport } from '../core/multistage-executor.js'
import type { IFormatter } from '../formatters/formatter.js'
import {
  GitLabClient,
  GitLabPipeline,
  formatLevelComment,
  formatStatusComment,
  type GitLabNote,
} from '../integrations/gitlab-integration.js'
import { NO_TTY_CLI_INTEGRATION } from '../integrations/no-tty-cli-integration.js'
import { logger, UserError } from '../utils/index.js'

// ---------- Metadata parsing (mirrors packages/bridge/src/metadata.ts) ----------

interface IgCommentMetadata {
  level: number
  workspaces: string[]
  planId: string
  commitSha?: string | undefined
}

const IG_META_PATTERN = /<!-- ig-meta:(.*?) -->/s

function parseMetadata(noteBody: string): IgCommentMetadata | null {
  const match = IG_META_PATTERN.exec(noteBody)
  if (!match?.[1]) return null

  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>
    if (typeof parsed.level !== 'number' || parsed.level < 1) return null
    if (!Array.isArray(parsed.workspaces) || parsed.workspaces.length === 0) return null
    if (typeof parsed.planId !== 'string' || parsed.planId.length === 0) return null
    return {
      level: parsed.level,
      workspaces: parsed.workspaces as string[],
      planId: parsed.planId,
      commitSha: typeof parsed.commitSha === 'string' ? parsed.commitSha : undefined,
    }
  } catch {
    return null
  }
}

// ---------- Types ----------

interface IgComment {
  noteId: number
  metadata: IgCommentMetadata
  body: string
  hasApproval: boolean
}

type MRState = 'FRESH' | 'STALE' | 'PENDING' | 'PARTIAL' | 'COMPLETE'

export interface GitLabCiOptions {
  execContext: ExecutionContext
  formatter: IFormatter
  approvalEmoji?: string | undefined
}

// ---------- Helpers ----------

export function markCommentAsStale(body: string): string {
  if (/\(stale — new commits pushed\)/.test(body)) return body
  return body
    .replace(/^## InfraGlue Plan/m, '## ~~InfraGlue Plan')
    .replace(/^(## ~~InfraGlue Plan[^\n]*)/m, '$1~~ (stale — new commits pushed)')
}

export function determineContiguousApproved(comments: IgComment[]): number {
  const approvedLevels = new Set(comments.filter((c) => c.hasApproval).map((c) => c.metadata.level))
  let maxLevel = 0
  while (approvedLevels.has(maxLevel + 1)) {
    maxLevel++
  }
  return maxLevel
}

function determineMRState(freshComments: IgComment[], hasStaleComments: boolean): MRState {
  if (hasStaleComments && freshComments.length === 0) return 'STALE'
  if (freshComments.length === 0) return 'FRESH'

  const hasAnyApproval = freshComments.some((c) => c.hasApproval)
  if (!hasAnyApproval) return 'PENDING'

  const maxCommentedLevel = Math.max(...freshComments.map((c) => c.metadata.level))
  const contiguousApproved = determineContiguousApproved(freshComments)
  if (contiguousApproved >= maxCommentedLevel) return 'COMPLETE'

  return 'PARTIAL'
}

// ---------- Main command ----------

export async function runGitLabCi(opts: GitLabCiOptions): Promise<number> {
  if (!GitLabPipeline.isInPipeline() || !GitLabPipeline.getMergeRequestIid()) {
    throw new UserError('ig ci must run inside a GitLab merge request pipeline.')
  }

  const commitSha = GitLabPipeline.getCommitSha()
  if (!commitSha) {
    throw new UserError('CI_COMMIT_SHA not available.')
  }

  const approvalEmoji = opts.approvalEmoji ?? 'thumbsup'
  const gitlabClient = new GitLabClient()
  const planId = process.env['CI_PIPELINE_ID'] ?? commitSha

  // Phase 1: Read MR comments and check for approval emojis
  logger.info('Reading MR comments...')
  const notes = await gitlabClient.listNotes()
  const igComments = await resolveIgComments(notes, gitlabClient, approvalEmoji)

  // Phase 2: Partition into stale and fresh
  const staleComments = igComments.filter((c) => c.metadata.commitSha !== commitSha)
  const freshComments = igComments.filter((c) => c.metadata.commitSha === commitSha)

  // Phase 3: Mark stale comments
  if (staleComments.length > 0) {
    logger.info(`Marking ${staleComments.length} stale comment(s)...`)
    for (const comment of staleComments) {
      await gitlabClient.editNote(comment.noteId, markCommentAsStale(comment.body))
    }
  }

  // Phase 4: Determine state
  const state = determineMRState(freshComments, staleComments.length > 0)
  logger.info(`MR state: ${state}`)

  const executor = new MultistageExecutor(opts.execContext)

  switch (state) {
    case 'PENDING': {
      const levels = freshComments.map((c) => c.metadata.level).sort((a, b) => a - b)
      logger.info(`Waiting for approvals on level(s): ${levels.join(', ')}`)
      return 0
    }

    case 'FRESH':
    case 'STALE': {
      // Plan from the beginning
      const exitCode = await planAndPostComments(executor, opts.formatter, gitlabClient, planId, commitSha, 0)
      if (exitCode === 0) {
        await gitlabClient.addComment(formatStatusComment('no-changes', commitSha))
        logger.info('Posted no-changes comment to GitLab MR')
      }
      return exitCode
    }

    case 'PARTIAL':
    case 'COMPLETE': {
      const maxApproved = determineContiguousApproved(freshComments)
      logger.info(`Applying approved levels: 1..${maxApproved}`)

      // Apply approved levels
      await executor.exec({
        approve: 'all',
        upToLevel: maxApproved,
        integration: NO_TTY_CLI_INTEGRATION,
        formatter: opts.formatter,
      })

      // Plan remaining levels
      const commentedLevels = new Set(freshComments.map((c) => c.metadata.level))
      const exitCode = await planAndPostComments(
        executor,
        opts.formatter,
        gitlabClient,
        planId,
        commitSha,
        maxApproved,
        commentedLevels,
      )
      if (exitCode === 0) {
        await gitlabClient.addComment(formatStatusComment('all-applied', commitSha))
        logger.info('Posted all-applied comment to GitLab MR')
      }
      return exitCode
    }
  }
}

async function resolveIgComments(
  notes: GitLabNote[],
  gitlabClient: GitLabClient,
  approvalEmoji: string,
): Promise<IgComment[]> {
  const igComments: IgComment[] = []

  for (const note of notes) {
    const metadata = parseMetadata(note.body)
    if (!metadata) continue

    const emojis = await gitlabClient.listNoteAwardEmojis(note.id)
    const hasApproval = emojis.some((e) => e.name === approvalEmoji)

    igComments.push({
      noteId: note.id,
      metadata,
      body: note.body,
      hasApproval,
    })
  }

  return igComments
}

async function planAndPostComments(
  executor: MultistageExecutor,
  formatter: IFormatter,
  gitlabClient: GitLabClient,
  planId: string,
  commitSha: string,
  startFromLevel: number,
  existingCommentedLevels?: Set<number>,
): Promise<number> {
  const onLevelPlanned = async (data: LevelPlanReport) => {
    const levelNumber = data.levelIndex + 1
    if (existingCommentedLevels?.has(levelNumber)) {
      logger.debug(`Comment already exists for level ${levelNumber}, skipping`)
      return
    }

    const comment = formatLevelComment({
      levelNumber,
      levelsCount: data.levelsCount,
      workspacePlans: data.levelPlans.map((lp) => ({
        workspaceName: lp.workspace.name,
        plan: lp.plan,
      })),
      planId,
      commitSha,
    })
    await gitlabClient.addComment(comment)
    logger.info(`Posted plan comment for Level ${levelNumber} to GitLab MR`)
  }

  try {
    const result = await executor.plan({
      formatter,
      startFromLevel,
      onLevelPlanned,
    })

    return result.hasChanges ? 2 : 0
  } catch (error) {
    // If planning fails due to missing inputs (upstream level not yet applied),
    // this is expected — we've already posted comments for the levels we could plan.
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('is not found') || msg.includes('no outputs available')) {
      logger.info('Cannot plan further levels — waiting for upstream approval and apply')
      return 2
    } else {
      throw error
    }
  }
}
