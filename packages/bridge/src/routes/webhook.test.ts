import { Hono } from 'hono'
import { describe, it, expect, vi } from 'vitest'
import type { CiTrigger, TriggerResult } from '../ci-triggers/types.js'
import { BridgeError, WebhookValidationError } from '../errors.js'
import type { ApprovalEvent, GitHost } from '../git-hosts/types.js'
import { serializeMetadata } from '../metadata.js'
import { createErrorHandler, createWebhookRoute } from './webhook.js'

function createMockGitHost(overrides: Partial<GitHost> = {}): GitHost {
  return {
    parseWebhook: vi.fn().mockReturnValue({
      projectId: '42',
      mergeRequestIid: '7',
      noteId: 12345,
      sourceBranch: 'feature/add-redis',
      apiBaseUrl: 'https://gitlab.example.com/api/v4',
      actor: 'johndoe',
    } satisfies ApprovalEvent),
    fetchNoteBody: vi
      .fn()
      .mockResolvedValue(
        `## Level 1 Preview\n${serializeMetadata({ level: 1, workspaces: ['docker-network'], planId: 'plan-abc' })}`,
      ),
    ...overrides,
  }
}

function createMockTrigger(overrides: Partial<CiTrigger> = {}): CiTrigger {
  return {
    trigger: vi.fn().mockResolvedValue({
      pipelineId: 999,
      webUrl: 'https://gitlab.example.com/-/pipelines/999',
    } satisfies TriggerResult),
    ...overrides,
  }
}

function createApp(gitHost: GitHost, ciTrigger: CiTrigger) {
  const app = new Hono()
  app.onError(createErrorHandler())
  app.route('/', createWebhookRoute({ gitHost, createCiTrigger: () => ciTrigger }))
  return app
}

async function postWebhook(app: Hono, body: unknown = {}) {
  const req = new Request('http://localhost/webhooks/gitlab', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-gitlab-token': 'secret' },
    body: JSON.stringify(body),
  })
  return app.request(req)
}

describe('webhook route', () => {
  it('processes a valid approval event end-to-end', async () => {
    const gitHost = createMockGitHost()
    const ciTrigger = createMockTrigger()
    const app = createApp(gitHost, ciTrigger)

    const res = await postWebhook(app)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({
      triggered: true,
      pipelineId: 999,
      webUrl: 'https://gitlab.example.com/-/pipelines/999',
      level: 1,
      workspaces: ['docker-network'],
    })

    expect(ciTrigger.trigger).toHaveBeenCalledWith('42', 'feature/add-redis', {
      IG_ACTION: 'apply',
      IG_APPROVED_LEVEL: '1',
      IG_PLAN_ID: 'plan-abc',
      IG_MR_IID: '7',
    })
  })

  it('returns ignored when parseWebhook returns null', async () => {
    const gitHost = createMockGitHost({ parseWebhook: vi.fn().mockReturnValue(null) })
    const ciTrigger = createMockTrigger()
    const app = createApp(gitHost, ciTrigger)

    const res = await postWebhook(app)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ ignored: true, reason: 'irrelevant event' })
    expect(ciTrigger.trigger).not.toHaveBeenCalled()
  })

  it('returns ignored when note has no ig metadata', async () => {
    const gitHost = createMockGitHost({
      fetchNoteBody: vi.fn().mockResolvedValue('Just a regular comment'),
    })
    const ciTrigger = createMockTrigger()
    const app = createApp(gitHost, ciTrigger)

    const res = await postWebhook(app)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ ignored: true, reason: 'no ig metadata in note' })
    expect(ciTrigger.trigger).not.toHaveBeenCalled()
  })

  it('returns 401 when webhook validation fails', async () => {
    const gitHost = createMockGitHost({
      parseWebhook: vi.fn().mockImplementation(() => {
        throw new WebhookValidationError('Invalid token')
      }),
    })
    const ciTrigger = createMockTrigger()
    const app = createApp(gitHost, ciTrigger)

    const res = await postWebhook(app)
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json).toEqual({ error: 'Invalid token' })
  })

  it('returns 502 when trigger fails', async () => {
    const gitHost = createMockGitHost()
    const ciTrigger = createMockTrigger({
      trigger: vi.fn().mockRejectedValue(new BridgeError('Trigger failed', 502)),
    })
    const app = createApp(gitHost, ciTrigger)

    const res = await postWebhook(app)
    const json = await res.json()

    expect(res.status).toBe(502)
    expect(json).toEqual({ error: 'Trigger failed' })
  })

  it('returns 500 on unexpected errors', async () => {
    const gitHost = createMockGitHost({
      fetchNoteBody: vi.fn().mockRejectedValue(new Error('Network error')),
    })
    const ciTrigger = createMockTrigger()
    const app = createApp(gitHost, ciTrigger)

    const res = await postWebhook(app)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json).toEqual({ error: 'Internal server error' })
  })
})
