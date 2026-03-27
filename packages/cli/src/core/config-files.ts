import type { EnvironmentConfig } from '../providers'

export interface VaultConfig {
  address?: string
  role?: string
}

export interface MonorepoConfig {
  workspace?: string[]
  output?: Record<string, string>
  vars?: Record<string, string>
  vault?: VaultConfig
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
