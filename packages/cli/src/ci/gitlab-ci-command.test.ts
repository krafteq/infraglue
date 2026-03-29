import { vi, describe, it, expect, beforeEach } from 'vitest'
import { markCommentAsStale, determineContiguousApproved, runGitLabCi } from './gitlab-ci-command.js'
import type { GitLabNote, GitLabAwardEmoji } from '../integrations/gitlab-integration.js'

// Mock GitLabPipeline env
function setGitLabEnv(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    GITLAB_CI: 'true',
    CI_MERGE_REQUEST_PROJECT_ID: '1',
    CI_MERGE_REQUEST_IID: '42',
    CI_API_V4_URL: 'https://gitlab.example.com/api/v4',
    CI_COMMIT_SHA: 'abc123',
    CI_PIPELINE_ID: 'pipeline-1',
    GITLAB_ACCESS_TOKEN: 'test-token',
  }
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    process.env[key] = value
  }
}

function clearGitLabEnv() {
  for (const key of [
    'GITLAB_CI',
    'CI_MERGE_REQUEST_PROJECT_ID',
    'CI_MERGE_REQUEST_IID',
    'CI_API_V4_URL',
    'CI_COMMIT_SHA',
    'CI_PIPELINE_ID',
    'GITLAB_ACCESS_TOKEN',
  ]) {
    delete process.env[key]
  }
}

// Mock modules
const mockAddComment = vi.fn()
const mockListNotes = vi.fn<() => Promise<GitLabNote[]>>()
const mockListNoteAwardEmojis = vi.fn<(noteId: number) => Promise<GitLabAwardEmoji[]>>()
const mockEditNote = vi.fn()

vi.mock('../integrations/gitlab-integration.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../integrations/gitlab-integration.js')>()
  return {
    ...original,
    GitLabClient: vi.fn().mockImplementation(() => ({
      addComment: mockAddComment,
      listNotes: mockListNotes,
      listNoteAwardEmojis: mockListNoteAwardEmojis,
      editNote: mockEditNote,
    })),
  }
})

const mockExec = vi.fn()
const mockPlan = vi.fn()

vi.mock('../core/multistage-executor.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../core/multistage-executor.js')>()
  return {
    ...original,
    MultistageExecutor: vi.fn().mockImplementation(() => ({
      exec: mockExec,
      plan: mockPlan,
    })),
  }
})

function makeNote(id: number, level: number, commitSha = 'abc123'): GitLabNote {
  return {
    id,
    body: `## InfraGlue Plan — Level ${level}/3\n<!-- ig-meta:{"level":${level},"workspaces":["ws${level}"],"planId":"plan-1","commitSha":"${commitSha}"} -->`,
    system: false,
    updated_at: '2024-01-01T00:00:00Z',
  }
}

function makeFormatter() {
  return { format: vi.fn(() => 'formatted') }
}

describe('markCommentAsStale', () => {
  it('wraps the header in strikethrough', () => {
    const body = '## InfraGlue Plan — Level 1/3\nSome content'
    const result = markCommentAsStale(body)
    expect(result).toContain('## ~~InfraGlue Plan — Level 1/3~~ (stale — new commits pushed)')
    expect(result).toContain('Some content')
  })

  it('handles body without matching header gracefully', () => {
    const body = '## Some other comment'
    const result = markCommentAsStale(body)
    expect(result).toBe('## Some other comment')
  })

  it('is idempotent — does not accumulate stale markers on repeated calls', () => {
    const body = '## InfraGlue Plan — Level 1/1\nSome content'
    const once = markCommentAsStale(body)
    const twice = markCommentAsStale(once)
    const thrice = markCommentAsStale(twice)
    expect(twice).toBe(once)
    expect(thrice).toBe(once)
  })
})

describe('determineContiguousApproved', () => {
  it('returns 0 when no comments are approved', () => {
    const comments = [
      { noteId: 1, metadata: { level: 1, workspaces: ['a'], planId: 'x' }, body: '', hasApproval: false },
    ]
    expect(determineContiguousApproved(comments)).toBe(0)
  })

  it('returns max contiguous level from 1', () => {
    const comments = [
      { noteId: 1, metadata: { level: 1, workspaces: ['a'], planId: 'x' }, body: '', hasApproval: true },
      { noteId: 2, metadata: { level: 2, workspaces: ['b'], planId: 'x' }, body: '', hasApproval: true },
      { noteId: 3, metadata: { level: 3, workspaces: ['c'], planId: 'x' }, body: '', hasApproval: false },
    ]
    expect(determineContiguousApproved(comments)).toBe(2)
  })

  it('returns 0 when level 1 is not approved even if level 2 is', () => {
    const comments = [
      { noteId: 1, metadata: { level: 1, workspaces: ['a'], planId: 'x' }, body: '', hasApproval: false },
      { noteId: 2, metadata: { level: 2, workspaces: ['b'], planId: 'x' }, body: '', hasApproval: true },
    ]
    expect(determineContiguousApproved(comments)).toBe(0)
  })
})

describe('runGitLabCi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearGitLabEnv()
    process.exitCode = undefined
  })

  it('throws when not in GitLab MR pipeline', async () => {
    await expect(runGitLabCi({ execContext: {} as never, formatter: makeFormatter() })).rejects.toThrow(
      'ig ci must run inside a GitLab merge request pipeline',
    )
  })

  it('FRESH state: plans and posts comments', async () => {
    setGitLabEnv()
    mockListNotes.mockResolvedValue([])
    mockPlan.mockResolvedValue({ hasChanges: true })

    await runGitLabCi({ execContext: {} as never, formatter: makeFormatter() })

    expect(mockExec).not.toHaveBeenCalled()
    expect(mockPlan).toHaveBeenCalledWith(expect.objectContaining({ startFromLevel: 0 }))
  })

  it('STALE state: marks old comments stale, then plans fresh', async () => {
    setGitLabEnv()
    mockListNotes.mockResolvedValue([makeNote(100, 1, 'old-sha')])
    mockListNoteAwardEmojis.mockResolvedValue([])
    mockPlan.mockResolvedValue({ hasChanges: false })

    await runGitLabCi({ execContext: {} as never, formatter: makeFormatter() })

    expect(mockEditNote).toHaveBeenCalledTimes(1)
    expect(mockEditNote.mock.calls[0][0]).toBe(100)
    expect(mockEditNote.mock.calls[0][1]).toContain('stale')
    expect(mockPlan).toHaveBeenCalledWith(expect.objectContaining({ startFromLevel: 0 }))
  })

  it('PENDING state: exits without action', async () => {
    setGitLabEnv()
    mockListNotes.mockResolvedValue([makeNote(100, 1)])
    mockListNoteAwardEmojis.mockResolvedValue([])

    const exitCode = await runGitLabCi({ execContext: {} as never, formatter: makeFormatter() })

    expect(mockExec).not.toHaveBeenCalled()
    expect(mockPlan).not.toHaveBeenCalled()
    expect(exitCode).toBe(0)
  })

  it('PARTIAL state: applies approved level, then plans remaining', async () => {
    setGitLabEnv()
    mockListNotes.mockResolvedValue([makeNote(100, 1), makeNote(101, 2)])
    mockListNoteAwardEmojis.mockImplementation(async (noteId: number) => {
      if (noteId === 100) return [{ id: 1, name: 'thumbsup', user: { username: 'dev' } }]
      return []
    })
    mockExec.mockResolvedValue(undefined)
    mockPlan.mockResolvedValue({ hasChanges: true })

    await runGitLabCi({ execContext: {} as never, formatter: makeFormatter() })

    expect(mockExec).toHaveBeenCalledWith(
      expect.objectContaining({
        approve: 'all',
        upToLevel: 1,
      }),
    )
    expect(mockPlan).toHaveBeenCalledWith(expect.objectContaining({ startFromLevel: 1 }))
  })

  it('COMPLETE state: applies all approved levels', async () => {
    setGitLabEnv()
    mockListNotes.mockResolvedValue([makeNote(100, 1), makeNote(101, 2)])
    mockListNoteAwardEmojis.mockResolvedValue([{ id: 1, name: 'thumbsup', user: { username: 'dev' } }])
    mockExec.mockResolvedValue(undefined)
    mockPlan.mockResolvedValue({ hasChanges: false })

    await runGitLabCi({ execContext: {} as never, formatter: makeFormatter() })

    expect(mockExec).toHaveBeenCalledWith(
      expect.objectContaining({
        approve: 'all',
        upToLevel: 2,
      }),
    )
  })

  it('respects custom approval emoji', async () => {
    setGitLabEnv()
    mockListNotes.mockResolvedValue([makeNote(100, 1)])
    mockListNoteAwardEmojis.mockResolvedValue([{ id: 1, name: 'rocket', user: { username: 'dev' } }])
    mockExec.mockResolvedValue(undefined)
    mockPlan.mockResolvedValue({ hasChanges: false })

    await runGitLabCi({ execContext: {} as never, formatter: makeFormatter(), approvalEmoji: 'rocket' })

    // Level 1 approved with rocket emoji → should exec
    expect(mockExec).toHaveBeenCalled()
  })
})
