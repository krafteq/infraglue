import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'

export interface IState {
  current_environment: string
}

const STATE_FILE_DIR = '.ig'
const STATE_FILE_PATH = `${STATE_FILE_DIR}/state.json`
const STATE_FILE_ENCODING = 'utf-8'

export async function readInternalState(projectPath: string): Promise<IState | null> {
  const stateFilePath = join(projectPath, STATE_FILE_PATH)
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
  const stateFilePath = join(projectPath, STATE_FILE_PATH)
  const content = JSON.stringify(state, null, 2)
  await mkdir(join(projectPath, STATE_FILE_DIR), { recursive: true })
  await writeFile(stateFilePath, content, STATE_FILE_ENCODING)
}
