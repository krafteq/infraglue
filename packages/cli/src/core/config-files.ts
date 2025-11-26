import type { EnvironmentConfig } from '../providers'

export interface MonorepoConfig {
  workspace?: string[]
  output?: Record<string, string>
  [key: string]: unknown
}

export interface WorkspaceConfig {
  provider?: string
  injection?: Record<string, string>
  output?: Record<string, string>
  depends_on?: string[]
  envs?: Record<string, EnvironmentConfig>
  alias?: string
  [key: string]: unknown
}
