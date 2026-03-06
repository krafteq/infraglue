import { parseDotEnv, loadDotEnvFiles } from './dotenv.js'
import { UserError } from './errors.js'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

describe('parseDotEnv', () => {
  it('should parse simple KEY=VALUE', () => {
    expect(parseDotEnv('FOO=bar')).toEqual({ FOO: 'bar' })
  })

  it('should parse multiple lines', () => {
    expect(parseDotEnv('A=1\nB=2\nC=3')).toEqual({ A: '1', B: '2', C: '3' })
  })

  it('should handle double-quoted values', () => {
    expect(parseDotEnv('FOO="hello world"')).toEqual({ FOO: 'hello world' })
  })

  it('should handle single-quoted values', () => {
    expect(parseDotEnv("FOO='hello world'")).toEqual({ FOO: 'hello world' })
  })

  it('should skip comments', () => {
    expect(parseDotEnv('# this is a comment\nFOO=bar')).toEqual({ FOO: 'bar' })
  })

  it('should skip blank lines', () => {
    expect(parseDotEnv('\n\nFOO=bar\n\n')).toEqual({ FOO: 'bar' })
  })

  it('should strip export prefix', () => {
    expect(parseDotEnv('export FOO=bar')).toEqual({ FOO: 'bar' })
  })

  it('should handle values containing =', () => {
    expect(parseDotEnv('FOO=a=b=c')).toEqual({ FOO: 'a=b=c' })
  })

  it('should handle empty values', () => {
    expect(parseDotEnv('FOO=')).toEqual({ FOO: '' })
  })

  it('should handle empty quoted values', () => {
    expect(parseDotEnv('FOO=""')).toEqual({ FOO: '' })
  })

  it('should skip lines without =', () => {
    expect(parseDotEnv('INVALID_LINE\nFOO=bar')).toEqual({ FOO: 'bar' })
  })

  it('should skip __proto__ key', () => {
    const result = parseDotEnv('__proto__=malicious\nFOO=bar')
    expect(result['FOO']).toBe('bar')
    expect('__proto__' in result).toBe(false)
  })

  it('should skip constructor key', () => {
    const result = parseDotEnv('constructor=malicious\nFOO=bar')
    expect(result['FOO']).toBe('bar')
    expect('constructor' in result).toBe(false)
  })

  it('should handle mixed formats', () => {
    const content = `
# Database config
DB_HOST=localhost
DB_PORT=5432
export DB_NAME="my_database"
DB_PASSWORD='s3cret=value'

# API config
API_KEY=abc123
`
    expect(parseDotEnv(content)).toEqual({
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_NAME: 'my_database',
      DB_PASSWORD: 's3cret=value',
      API_KEY: 'abc123',
    })
  })
})

describe('loadDotEnvFiles', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ig-dotenv-'))
    await mkdir(join(tmpDir, '.ig'), { recursive: true })
  })

  afterEach(async () => {
    // Clean up env vars set during tests
    delete process.env['DOTENV_TEST_BASE']
    delete process.env['DOTENV_TEST_ENV']
    delete process.env['DOTENV_TEST_OVERRIDE']
    delete process.env['DOTENV_TEST_EXISTING']
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('should load .ig/.env into process.env', async () => {
    await writeFile(join(tmpDir, '.ig', '.env'), 'DOTENV_TEST_BASE=base_value')

    await loadDotEnvFiles(tmpDir)

    expect(process.env['DOTENV_TEST_BASE']).toBe('base_value')
  })

  it('should load .ig/.env.{envName} when envName provided', async () => {
    await writeFile(join(tmpDir, '.ig', '.env.dev'), 'DOTENV_TEST_ENV=dev_value')

    await loadDotEnvFiles(tmpDir, 'dev')

    expect(process.env['DOTENV_TEST_ENV']).toBe('dev_value')
  })

  it('should override base with env-specific file', async () => {
    await writeFile(join(tmpDir, '.ig', '.env'), 'DOTENV_TEST_OVERRIDE=base')
    await writeFile(join(tmpDir, '.ig', '.env.prod'), 'DOTENV_TEST_OVERRIDE=prod')

    await loadDotEnvFiles(tmpDir, 'prod')

    expect(process.env['DOTENV_TEST_OVERRIDE']).toBe('prod')
  })

  it('should override existing process.env', async () => {
    process.env['DOTENV_TEST_EXISTING'] = 'original'
    await writeFile(join(tmpDir, '.ig', '.env'), 'DOTENV_TEST_EXISTING=from_file')

    await loadDotEnvFiles(tmpDir)

    expect(process.env['DOTENV_TEST_EXISTING']).toBe('from_file')
  })

  it('should silently ignore missing .ig/.env', async () => {
    // No .env file created — should not throw
    await expect(loadDotEnvFiles(tmpDir)).resolves.toBeUndefined()
  })

  it('should silently ignore missing .ig/.env.{envName}', async () => {
    await writeFile(join(tmpDir, '.ig', '.env'), 'DOTENV_TEST_BASE=value')

    // No .env.staging file — should not throw
    await expect(loadDotEnvFiles(tmpDir, 'staging')).resolves.toBeUndefined()
    expect(process.env['DOTENV_TEST_BASE']).toBe('value')
  })

  it('should reject envName with path separators', async () => {
    await expect(loadDotEnvFiles(tmpDir, '../etc/passwd')).rejects.toThrow(UserError)
    await expect(loadDotEnvFiles(tmpDir, 'foo/bar')).rejects.toThrow(UserError)
    await expect(loadDotEnvFiles(tmpDir, 'foo\\bar')).rejects.toThrow(UserError)
  })

  it('should reject envName with ..', async () => {
    await expect(loadDotEnvFiles(tmpDir, '..')).rejects.toThrow(UserError)
  })

  it('should silently ignore missing .ig directory', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'ig-dotenv-empty-'))
    try {
      await expect(loadDotEnvFiles(emptyDir)).resolves.toBeUndefined()
    } finally {
      await rm(emptyDir, { recursive: true, force: true })
    }
  })
})
