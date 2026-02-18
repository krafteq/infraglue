import { envConfigSchema, monorepoConfigSchema, workspaceConfigSchema, formatZodError } from './schemas.js'
import { ZodError } from 'zod'

describe('envConfigSchema', () => {
  it('should coerce numeric vars to strings', () => {
    const result = envConfigSchema.parse({
      vars: { port: 3000, count: 5 },
    })
    expect(result.vars).toEqual({ port: '3000', count: '5' })
  })

  it('should transform null vars to undefined', () => {
    const result = envConfigSchema.parse({ vars: null })
    expect(result.vars).toBeUndefined()
  })

  it('should transform null var_files to undefined', () => {
    const result = envConfigSchema.parse({ var_files: null })
    expect(result.var_files).toBeUndefined()
  })

  it('should accept full env config', () => {
    const result = envConfigSchema.parse({
      backend_file: './backend.tf',
      backend_type: 'local',
      backend_config: { path: './state.tfstate' },
      vars: { name: 'test' },
      var_files: ['./dev.tfvars'],
    })
    expect(result.backend_file).toBe('./backend.tf')
    expect(result.backend_type).toBe('local')
    expect(result.backend_config).toEqual({ path: './state.tfstate' })
    expect(result.vars).toEqual({ name: 'test' })
    expect(result.var_files).toEqual(['./dev.tfvars'])
  })

  it('should accept empty object', () => {
    const result = envConfigSchema.parse({})
    expect(result.backend_file).toBeUndefined()
    expect(result.vars).toBeUndefined()
  })
})

describe('workspaceConfigSchema', () => {
  it('should accept minimal workspace config', () => {
    const result = workspaceConfigSchema.parse({})
    expect(result.provider).toBeUndefined()
    expect(result.injection).toBeUndefined()
    expect(result.depends_on).toBeUndefined()
    expect(result.envs).toBeUndefined()
  })

  it('should accept full workspace config', () => {
    const result = workspaceConfigSchema.parse({
      provider: 'terraform',
      injection: { db_host: '../db:host' },
      output: { url: 'http://localhost' },
      depends_on: ['../network'],
      envs: { dev: { vars: { port: 3000 } } },
      alias: 'my-workspace',
    })
    expect(result.provider).toBe('terraform')
    expect(result.alias).toBe('my-workspace')
    expect(result.depends_on).toEqual(['../network'])
  })

  it('should reject invalid depends_on type', () => {
    const result = workspaceConfigSchema.safeParse({
      depends_on: 'not-an-array',
    })
    expect(result.success).toBe(false)
  })
})

describe('monorepoConfigSchema', () => {
  it('should accept valid config', () => {
    const result = monorepoConfigSchema.parse({
      workspace: ['./*'],
      output: { url: './service:url' },
    })
    expect(result.workspace).toEqual(['./*'])
    expect(result.output).toEqual({ url: './service:url' })
  })

  it('should require at least one workspace glob', () => {
    const result = monorepoConfigSchema.safeParse({ workspace: [] })
    expect(result.success).toBe(false)
  })

  it('should reject missing workspace field', () => {
    const result = monorepoConfigSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should accept config without output', () => {
    const result = monorepoConfigSchema.parse({ workspace: ['./apps/*'] })
    expect(result.output).toBeUndefined()
  })
})

describe('formatZodError', () => {
  it('should format error with path', () => {
    const result = monorepoConfigSchema.safeParse({ workspace: [] })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = formatZodError(result.error)
      expect(msg).toContain('workspace')
    }
  })

  it('should format error without path', () => {
    const error = new ZodError([
      {
        code: 'custom',
        message: 'Custom error',
        path: [],
      },
    ])
    const msg = formatZodError(error)
    expect(msg).toBe('Custom error')
  })

  it('should join multiple issues', () => {
    const error = new ZodError([
      { code: 'custom', message: 'Error 1', path: ['field1'] },
      { code: 'custom', message: 'Error 2', path: ['field2'] },
    ])
    const msg = formatZodError(error)
    expect(msg).toContain('field1: Error 1')
    expect(msg).toContain('field2: Error 2')
    expect(msg).toContain('\n')
  })
})
