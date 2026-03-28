import { describe, it, expect } from 'vitest'
import { WebhookValidationError } from '../../errors.js'
import { GitLabWebhookHandler, deriveApiBaseUrl } from './webhook-handler.js'

const defaultOptions = {
  webhookSecret: 'test-secret',
  approvalEmoji: 'thumbsup',
  accessToken: 'test-token',
}

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    object_kind: 'emoji',
    event_type: 'award',
    user: { username: 'johndoe', name: 'John Doe' },
    project: {
      id: 42,
      path_with_namespace: 'group/project',
      web_url: 'https://gitlab.example.com/group/project',
    },
    object_attributes: {
      action: 'award',
      name: 'thumbsup',
      awardable_type: 'Note',
      awardable_id: 12345,
    },
    merge_request: {
      iid: 7,
      source_branch: 'feature/add-redis',
      target_branch: 'main',
      title: 'Add Redis workspace',
      state: 'opened',
    },
    ...overrides,
  }
}

function makeHeaders(token = 'test-secret'): Record<string, string> {
  return { 'x-gitlab-token': token }
}

describe('GitLabWebhookHandler', () => {
  describe('parseWebhook', () => {
    it('parses a valid thumbsup emoji on a Note', () => {
      const handler = new GitLabWebhookHandler(defaultOptions)
      const result = handler.parseWebhook(makeHeaders(), makePayload())

      expect(result).toEqual({
        projectId: '42',
        mergeRequestIid: '7',
        noteId: 12345,
        sourceBranch: 'feature/add-redis',
        apiBaseUrl: 'https://gitlab.example.com/api/v4',
        actor: 'johndoe',
      })
    })

    it('throws WebhookValidationError on invalid token', () => {
      const handler = new GitLabWebhookHandler(defaultOptions)
      expect(() => handler.parseWebhook(makeHeaders('wrong-token'), makePayload())).toThrow(WebhookValidationError)
    })

    it('throws WebhookValidationError on missing token', () => {
      const handler = new GitLabWebhookHandler(defaultOptions)
      expect(() => handler.parseWebhook({}, makePayload())).toThrow(WebhookValidationError)
    })

    it('returns null for non-emoji webhook', () => {
      const handler = new GitLabWebhookHandler(defaultOptions)
      const result = handler.parseWebhook(makeHeaders(), { object_kind: 'push' })
      expect(result).toBeNull()
    })

    it('returns null for revoke action', () => {
      const handler = new GitLabWebhookHandler(defaultOptions)
      const payload = makePayload({
        object_attributes: {
          action: 'revoke',
          name: 'thumbsup',
          awardable_type: 'Note',
          awardable_id: 12345,
        },
      })
      const result = handler.parseWebhook(makeHeaders(), payload)
      expect(result).toBeNull()
    })

    it('returns null for wrong emoji name', () => {
      const handler = new GitLabWebhookHandler(defaultOptions)
      const payload = makePayload({
        object_attributes: {
          action: 'award',
          name: 'heart',
          awardable_type: 'Note',
          awardable_id: 12345,
        },
      })
      const result = handler.parseWebhook(makeHeaders(), payload)
      expect(result).toBeNull()
    })

    it('returns null when emoji is on MR (not Note)', () => {
      const handler = new GitLabWebhookHandler(defaultOptions)
      const payload = makePayload({
        object_attributes: {
          action: 'award',
          name: 'thumbsup',
          awardable_type: 'MergeRequest',
          awardable_id: 12345,
        },
      })
      const result = handler.parseWebhook(makeHeaders(), payload)
      expect(result).toBeNull()
    })

    it('returns null when MR is closed', () => {
      const handler = new GitLabWebhookHandler(defaultOptions)
      const payload = makePayload({
        merge_request: {
          iid: 7,
          source_branch: 'feature/add-redis',
          target_branch: 'main',
          title: 'Add Redis workspace',
          state: 'closed',
        },
      })
      const result = handler.parseWebhook(makeHeaders(), payload)
      expect(result).toBeNull()
    })

    it('respects custom approval emoji', () => {
      const handler = new GitLabWebhookHandler({ ...defaultOptions, approvalEmoji: 'rocket' })
      const payload = makePayload({
        object_attributes: {
          action: 'award',
          name: 'rocket',
          awardable_type: 'Note',
          awardable_id: 12345,
        },
      })
      const result = handler.parseWebhook(makeHeaders(), payload)
      expect(result).not.toBeNull()
      expect(result?.noteId).toBe(12345)
    })
  })
})

describe('deriveApiBaseUrl', () => {
  it('extracts API base from project web URL', () => {
    expect(deriveApiBaseUrl('https://gitlab.example.com/group/project')).toBe('https://gitlab.example.com/api/v4')
  })

  it('handles nested groups', () => {
    expect(deriveApiBaseUrl('https://gitlab.example.com/org/sub/project')).toBe('https://gitlab.example.com/api/v4')
  })

  it('handles custom ports', () => {
    expect(deriveApiBaseUrl('https://gitlab.local:8443/group/project')).toBe('https://gitlab.local:8443/api/v4')
  })
})
