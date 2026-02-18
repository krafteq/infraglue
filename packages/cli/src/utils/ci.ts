import ci from 'ci-info'
import { logger } from './logger.js'
import { isDebug } from './errors.js'

export function detectIntegration(explicit?: string): string {
  if (explicit) return explicit

  if (ci.isCI) {
    const detected = ci.GITLAB ? 'gitlab' : 'no-tty-cli'
    if (isDebug()) {
      logger.debug(`CI detected: ${ci.name ?? 'unknown'}. Using integration: ${detected}`)
    }
    return detected
  }

  return process.stdout.isTTY ? 'cli' : 'no-tty-cli'
}

export function isGitHubActions(): boolean {
  return ci.GITHUB_ACTIONS === true
}

export function startGroup(label: string): void {
  if (isGitHubActions()) {
    process.stderr.write(`::group::${label}\n`)
  }
}

export function endGroup(): void {
  if (isGitHubActions()) {
    process.stderr.write('::endgroup::\n')
  }
}

export { ci }
