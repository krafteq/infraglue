export interface IState {
  version?: string | undefined
  current_environment?: string | undefined
  next_environment?: string | undefined
  workspaces?: {
    [key: string]: IWorkspaceState
  }
}

export interface IWorkspaceState {
  env?: string | undefined
  outputs?: Record<string, string> | undefined
}
