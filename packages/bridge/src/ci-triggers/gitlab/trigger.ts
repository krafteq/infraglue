import { TriggerError } from '../../errors.js'
import { logger } from '../../logger.js'
import type { CiTrigger, TriggerResult } from '../types.js'

export class GitLabPipelineTrigger implements CiTrigger {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getTriggerToken: (projectId: string) => string,
  ) {}

  async trigger(projectId: string, ref: string, variables: Record<string, string>): Promise<TriggerResult> {
    const token = this.getTriggerToken(projectId)
    const url = `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/trigger/pipeline`

    const body = new URLSearchParams()
    body.set('token', token)
    body.set('ref', ref)
    for (const [key, value] of Object.entries(variables)) {
      body.set(`variables[${key}]`, value)
    }

    logger.debug(`Triggering pipeline: project=${projectId} ref=${ref} variables=${JSON.stringify(variables)}`)

    const response = await fetch(url, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    if (!response.ok) {
      const responseBody = await response.text()
      throw new TriggerError(`Failed to trigger pipeline: HTTP ${response.status}`, {
        status: response.status,
        body: responseBody,
      })
    }

    const result = (await response.json()) as { id: number; web_url: string }
    logger.info(`Pipeline triggered: ${result.web_url}`)

    return {
      pipelineId: result.id,
      webUrl: result.web_url,
    }
  }
}
