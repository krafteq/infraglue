import { join } from 'path'
import { readFile, writeFile, mkdir, rm } from 'fs/promises'

export interface IState {
  current_environment: string
}

const STATE_FILE_DIR = '.ig'
const STATE_FILE_NAME = `state.json`
const TEMPORAL_FILE_DIR = '.temp'
const STATE_FILE_ENCODING = 'utf-8'

export async function readInternalState(projectPath: string): Promise<IState | null> {
  const stateFilePath = join(projectPath, STATE_FILE_DIR, STATE_FILE_NAME)
  try {
    const content = await readFile(stateFilePath, STATE_FILE_ENCODING)
    return JSON.parse(content) as IState
  } catch (e) {
    if (e instanceof Error && (e as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw e
  }
}

export async function writeInternalState(projectPath: string, state: IState): Promise<void> {
  const stateFilePath = join(projectPath, STATE_FILE_DIR, STATE_FILE_NAME)
  const content = JSON.stringify(state, null, 2)
  await mkdir(join(projectPath, STATE_FILE_DIR), { recursive: true })
  await writeFile(stateFilePath, content, STATE_FILE_ENCODING)
}

export async function saveTemporalFile(projectPath: string, fileName: string, content: string): Promise<string> {
  const filePath = join(projectPath, STATE_FILE_DIR, TEMPORAL_FILE_DIR, fileName)
  await mkdir(join(projectPath, STATE_FILE_DIR, TEMPORAL_FILE_DIR), { recursive: true })
  await writeFile(filePath, content, STATE_FILE_ENCODING)
  return join(STATE_FILE_DIR, TEMPORAL_FILE_DIR, fileName)
}

export async function removeTemporalFile(projectPath: string, fileName: string): Promise<void> {
  const filePath = join(projectPath, STATE_FILE_DIR, TEMPORAL_FILE_DIR, fileName)
  await rm(filePath, { force: true })
}
