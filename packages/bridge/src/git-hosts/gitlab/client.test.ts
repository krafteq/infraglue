import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitHostApiError } from '../../errors.js'
import { GitLabApiClient } from './client.js'

describe('GitLabApiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchNoteBody', () => {
    it('fetches note body from GitLab API', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ id: 123, body: 'note content', author: { username: 'bot' } }),
      }
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response)

      const client = new GitLabApiClient('test-token')
      const body = await client.fetchNoteBody('https://gitlab.example.com/api/v4', '42', '7', 123)

      expect(body).toBe('note content')
      expect(fetch).toHaveBeenCalledWith('https://gitlab.example.com/api/v4/projects/42/merge_requests/7/notes/123', {
        headers: { 'PRIVATE-TOKEN': 'test-token' },
      })
    })

    it('throws GitHostApiError on non-OK response', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      }
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response)

      const client = new GitLabApiClient('test-token')

      await expect(client.fetchNoteBody('https://gitlab.example.com/api/v4', '42', '7', 999)).rejects.toThrow(
        GitHostApiError,
      )
    })

    it('includes upstream status in error', async () => {
      const mockResponse = {
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      }
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response)

      const client = new GitLabApiClient('test-token')

      try {
        await client.fetchNoteBody('https://gitlab.example.com/api/v4', '42', '7', 123)
        expect.fail('Should have thrown')
      } catch (err) {
        const error = err as GitHostApiError
        expect(error.upstream.status).toBe(403)
        expect(error.upstream.body).toBe('Forbidden')
      }
    })
  })
})
