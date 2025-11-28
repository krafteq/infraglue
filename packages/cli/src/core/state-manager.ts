import { join, relative } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import type { IState, IWorkspaceState } from './state-files'
import { Mutex } from '../utils/mutex'

const STATE_FILE_DIR = '.ig'
const STATE_FILE_NAME = `state.json`
const TEMPORAL_FILE_DIR = '.temp'
const GIT_IGNORE_FILE_NAME = '.gitignore'
const STATE_FILE_ENCODING = 'utf-8'
const mutex = new Mutex()

export class StateManager {
  private readonly stateFilePath: string
  private readonly stateFolderPath: string
  private readonly gitIgnoreFilePath: string
  private readonly tempDirPath: string

  public constructor(private readonly rootPath: string) {
    this.stateFolderPath = join(this.rootPath, STATE_FILE_DIR)
    this.stateFilePath = join(this.stateFolderPath, STATE_FILE_NAME)
    this.gitIgnoreFilePath = join(this.rootPath, GIT_IGNORE_FILE_NAME)
    this.tempDirPath = join(this.stateFolderPath, TEMPORAL_FILE_DIR)
  }

  public async read(): Promise<State> {
    const stateFile = await this.readInternalState()
    const state = new State()
    if (stateFile !== null) {
      state.restore(stateFile)
    }
    return state
  }

  public async update(func: (s: State) => void): Promise<void> {
    const unlock = await mutex.lock()
    try {
      const state = await this.read()
      func(state)
      await this.writeInternalState(state.serialize())
    } finally {
      unlock()
    }
  }

  // TODO: extract temp file mangement from here
  public async storeWorkspaceTempFile(
    workspacePath: string,
    fileName: string,
    content: string | Buffer,
  ): Promise<string> {
    const wsRelativePath = relative(this.rootPath, workspacePath)
    const folderPath = join(this.tempDirPath, wsRelativePath)
    await this.ensureInitialized()
    await mkdir(folderPath, { recursive: true })
    const filePath = join(folderPath, fileName)
    await writeFile(filePath, content, STATE_FILE_ENCODING)
    return relative(workspacePath, filePath)
  }

  private async readInternalState(): Promise<IState | null> {
    try {
      const content = await readFile(this.stateFilePath, STATE_FILE_ENCODING)
      return JSON.parse(content) as IState
    } catch (e) {
      if (e instanceof Error && (e as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw e
    }
  }

  private async writeInternalState(state: IState): Promise<void> {
    const content = JSON.stringify(state, null, 2)

    await this.ensureInitialized()
    await writeFile(this.stateFilePath, content, STATE_FILE_ENCODING)
  }

  private async ensureInitialized(): Promise<void> {
    await mkdir(this.stateFolderPath, { recursive: true })
    try {
      await writeFile(this.gitIgnoreFilePath, '*', { flag: 'wx' })
    } catch {
      // ignore, file exists
    }
  }
}

export class State {
  private _env: string | undefined
  private _nextEnv: string | undefined
  private _workspaces: Record<string, IWorkspaceState> | undefined

  public get env(): string | undefined {
    return this._env
  }

  public get nextEnv(): string | undefined {
    return this._nextEnv
  }

  public get isEnvSelected(): boolean {
    return this._env !== undefined && this._nextEnv === undefined
  }

  public get isEnvSelecting(): boolean {
    return this._nextEnv !== undefined
  }

  public get workspaces(): Record<string, IWorkspaceState> {
    if (!this._workspaces) {
      this._workspaces = {}
    }
    return this._workspaces
  }

  public workspace(name: string): IWorkspaceState {
    return this.workspaces[name] ?? (this.workspaces[name] = {})
  }

  public startSelectingEnv(env: string) {
    this._nextEnv = env
  }

  public finishEnvSelection(affectedWorkspaces: string[]) {
    if (!this.isEnvSelecting) {
      throw new Error('Env selection is not in progress')
    }

    this._env = this._nextEnv
    this._nextEnv = undefined

    for (const ws of affectedWorkspaces) {
      this.workspace(ws).env = this._env
    }
  }

  public restore(stateFile: IState) {
    this._env = stateFile?.current_environment
    this._nextEnv = stateFile?.next_environment
    this._workspaces = stateFile?.workspaces
  }

  public serialize(): IState {
    const state: IState = {
      current_environment: this._env,
    }
    if (this._nextEnv) {
      state.next_environment = this._nextEnv
    }
    if (this._workspaces) {
      state.workspaces = this._workspaces
    }
    return state
  }
}
