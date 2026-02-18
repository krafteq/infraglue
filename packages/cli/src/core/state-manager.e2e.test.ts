import { StateManager, State } from './state-manager.js'
import { mkdtemp, rm, readFile, access, constants } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

describe('StateManager', () => {
  let tmpDir: string
  let stateManager: StateManager

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ig-state-test-'))
    stateManager = new StateManager(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
  })

  describe('read/write roundtrip', () => {
    it('should return empty state when no file exists', async () => {
      const state = await stateManager.read()
      expect(state.env).toBeUndefined()
      expect(state.isEnvSelected).toBe(false)
    })

    it('should persist and restore state', async () => {
      await stateManager.update((s) => {
        s.startSelectingEnv('dev')
        s.finishEnvSelection(['ws1', 'ws2'])
      })

      const state = await stateManager.read()
      expect(state.env).toBe('dev')
      expect(state.isEnvSelected).toBe(true)
    })

    it('should persist workspace outputs', async () => {
      await stateManager.update((s) => {
        s.workspace('ws1').outputs = { key: 'value' }
      })

      const state = await stateManager.read()
      expect(state.workspace('ws1').outputs).toEqual({ key: 'value' })
    })
  })

  describe('.ig directory', () => {
    it('should create .ig directory on write', async () => {
      await stateManager.update((s) => s.startSelectingEnv('dev'))

      await access(join(tmpDir, '.ig'), constants.R_OK)
    })

    it('should create .gitignore in .ig directory', async () => {
      await stateManager.update((s) => s.startSelectingEnv('dev'))

      const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8')
      expect(content).toBe('*')
    })

    it('should not overwrite existing .gitignore', async () => {
      await stateManager.update((s) => s.startSelectingEnv('dev'))
      // Second write should not fail or overwrite
      await stateManager.update((s) => s.startSelectingEnv('qa'))

      const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8')
      expect(content).toBe('*')
    })
  })

  describe('concurrent updates', () => {
    it('should handle sequential updates preserving all data', async () => {
      for (let i = 0; i < 3; i++) {
        await stateManager.update((s) => {
          s.workspace(`ws-${i}`).outputs = { key: `value-${i}` }
        })
      }

      const state = await stateManager.read()
      for (let i = 0; i < 3; i++) {
        expect(state.workspace(`ws-${i}`).outputs).toEqual({ key: `value-${i}` })
      }
    })
  })

  describe('storeWorkspaceTempFile', () => {
    it('should create temp file and return relative path', async () => {
      const workspacePath = join(tmpDir, 'my-workspace')
      const relPath = await stateManager.storeWorkspaceTempFile(workspacePath, 'vars.tfvars', 'key=value')

      // The returned path is relative to the workspace path
      expect(relPath).toContain('.ig')
      expect(relPath).toContain('vars.tfvars')

      // File should actually exist
      const fullPath = join(workspacePath, relPath)
      const content = await readFile(fullPath, 'utf-8')
      expect(content).toBe('key=value')
    })
  })
})

describe('State', () => {
  describe('env selection lifecycle', () => {
    it('should start selecting env', () => {
      const state = new State()
      state.startSelectingEnv('dev')
      expect(state.isEnvSelecting).toBe(true)
      expect(state.isEnvSelected).toBe(false)
      expect(state.nextEnv).toBe('dev')
    })

    it('should finish env selection', () => {
      const state = new State()
      state.startSelectingEnv('dev')
      state.finishEnvSelection(['ws1'])

      expect(state.isEnvSelected).toBe(true)
      expect(state.isEnvSelecting).toBe(false)
      expect(state.env).toBe('dev')
    })

    it('should set workspace env on finish', () => {
      const state = new State()
      state.startSelectingEnv('dev')
      state.finishEnvSelection(['ws1', 'ws2'])

      expect(state.workspace('ws1').env).toBe('dev')
      expect(state.workspace('ws2').env).toBe('dev')
    })

    it('should throw when finishing without starting', () => {
      const state = new State()
      expect(() => state.finishEnvSelection(['ws1'])).toThrow('Env selection is not in progress')
    })
  })

  describe('serialize/restore', () => {
    it('should roundtrip through serialize/restore', () => {
      const state = new State()
      state.startSelectingEnv('prod')
      state.finishEnvSelection(['ws1'])
      state.workspace('ws1').outputs = { url: 'http://localhost' }

      const serialized = state.serialize()
      const restored = new State()
      restored.restore(serialized)

      expect(restored.env).toBe('prod')
      expect(restored.isEnvSelected).toBe(true)
      expect(restored.workspace('ws1').outputs).toEqual({ url: 'http://localhost' })
    })

    it('should serialize minimal state', () => {
      const state = new State()
      const serialized = state.serialize()
      expect(serialized).toEqual({ current_environment: undefined })
    })

    it('should include next_environment when selecting', () => {
      const state = new State()
      state.startSelectingEnv('dev')
      const serialized = state.serialize()
      expect(serialized.next_environment).toBe('dev')
    })
  })

  describe('workspace helper', () => {
    it('should lazily create workspace state', () => {
      const state = new State()
      const ws = state.workspace('new-ws')
      expect(ws).toBeDefined()
      expect(ws.env).toBeUndefined()
      expect(ws.outputs).toBeUndefined()
    })

    it('should return same workspace on repeated access', () => {
      const state = new State()
      const ws1 = state.workspace('ws')
      ws1.env = 'dev'
      const ws2 = state.workspace('ws')
      expect(ws2.env).toBe('dev')
    })
  })
})
