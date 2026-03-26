import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TriggerError } from '../../errors.js'
import { GitLabPipelineTrigger } from './trigger.js'

describe('GitLabPipelineTrigger', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('triggers a pipeline with correct URL and variables', async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({ id: 999, web_url: 'https://gitlab.example.com/group/project/-/pipelines/999' }),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response)

    const trigger = new GitLabPipelineTrigger('https://gitlab.example.com/api/v4', () => 'trigger-token-123')
    const result = await trigger.trigger('42', 'feature/add-redis', {
      IG_ACTION: 'apply',
      IG_APPROVED_LEVEL: '1',
    })

    expect(result).toEqual({
      pipelineId: 999,
      webUrl: 'https://gitlab.example.com/group/project/-/pipelines/999',
    })

    expect(fetch).toHaveBeenCalledWith(
      'https://gitlab.example.com/api/v4/projects/42/trigger/pipeline',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    )

    const call = vi.mocked(fetch).mock.calls[0]!
    const body = call[1]!.body as URLSearchParams
    expect(body.get('token')).toBe('trigger-token-123')
    expect(body.get('ref')).toBe('feature/add-redis')
    expect(body.get('variables[IG_ACTION]')).toBe('apply')
    expect(body.get('variables[IG_APPROVED_LEVEL]')).toBe('1')
  })

  it('throws TriggerError on non-OK response', async () => {
    const mockResponse = {
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response)

    const trigger = new GitLabPipelineTrigger('https://gitlab.example.com/api/v4', () => 'token')

    await expect(trigger.trigger('42', 'main', {})).rejects.toThrow(TriggerError)
  })

  it('uses project-specific trigger token', async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({ id: 1, web_url: 'https://example.com/-/pipelines/1' }),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response)

    const getToken = vi.fn().mockReturnValue('project-specific-token')
    const trigger = new GitLabPipelineTrigger('https://gitlab.example.com/api/v4', getToken)
    await trigger.trigger('99', 'main', {})

    expect(getToken).toHaveBeenCalledWith('99')
    const call = vi.mocked(fetch).mock.calls[0]!
    const body = call[1]!.body as URLSearchParams
    expect(body.get('token')).toBe('project-specific-token')
  })
})
