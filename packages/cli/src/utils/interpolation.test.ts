import { interpolateString, interpolateConfig } from './interpolation.js'
import { UserError } from './errors.js'
import type { VaultClient } from './vault-client.js'

function mockVaultClient(secrets: Record<string, Record<string, string>>): VaultClient {
  return {
    getSecret: vi.fn(async (path: string, field: string) => {
      const data = secrets[path]
      if (!data) throw new UserError(`Vault secret not found at '${path}'`)
      const value = data[field]
      if (value === undefined) throw new UserError(`Vault secret at '${path}' does not contain field '${field}'`)
      return value
    }),
  } as unknown as VaultClient
}

describe('interpolateString', () => {
  const env = { HOME: '/home/user', REGION: 'us-east-1', EMPTY: '' }

  it('should return plain strings unchanged', async () => {
    expect(await interpolateString('hello world', env)).toBe('hello world')
  })

  it('should substitute a single variable', async () => {
    expect(await interpolateString('${REGION}', env)).toBe('us-east-1')
  })

  it('should substitute multiple variables', async () => {
    expect(await interpolateString('${HOME}/config/${REGION}', env)).toBe('/home/user/config/us-east-1')
  })

  it('should substitute variable with surrounding text', async () => {
    expect(await interpolateString('prefix-${REGION}-suffix', env)).toBe('prefix-us-east-1-suffix')
  })

  it('should allow empty string env var', async () => {
    expect(await interpolateString('val=${EMPTY}!', env)).toBe('val=!')
  })

  it('should throw UserError for missing variable', async () => {
    await expect(interpolateString('${MISSING}', env)).rejects.toThrow(UserError)
    await expect(interpolateString('${MISSING}', env)).rejects.toThrow("Environment variable 'MISSING' is not set")
  })

  it('should include context in error message', async () => {
    await expect(interpolateString('${MISSING}', env, 'root ig.yaml vars')).rejects.toThrow(
      "Environment variable 'MISSING' is not set (in root ig.yaml vars)",
    )
  })

  it('should escape $${VAR} to literal ${VAR}', async () => {
    expect(await interpolateString('$${REGION}', env)).toBe('${REGION}')
  })

  it('should handle escape and real interpolation together', async () => {
    expect(await interpolateString('$${LITERAL} and ${REGION}', env)).toBe('${LITERAL} and us-east-1')
  })

  it('should pass through $ not followed by { or ${', async () => {
    expect(await interpolateString('$100', env)).toBe('$100')
  })

  it('should pass through ${...without closing brace', async () => {
    expect(await interpolateString('${UNCLOSED', env)).toBe('${UNCLOSED')
  })

  it('should handle empty string input', async () => {
    expect(await interpolateString('', env)).toBe('')
  })

  describe('vault references', () => {
    const vault = mockVaultClient({
      'secret/data/aws': { access_key: 'AKIA123', secret_key: 'shhh' },
      'secret/data/db': { password: 'dbpass' },
    })

    it('should resolve a vault reference', async () => {
      expect(await interpolateString('${vault:secret/data/db#password}', env, undefined, vault)).toBe('dbpass')
    })

    it('should resolve multiple vault references', async () => {
      const result = await interpolateString(
        '${vault:secret/data/aws#access_key}:${vault:secret/data/aws#secret_key}',
        env,
        undefined,
        vault,
      )
      expect(result).toBe('AKIA123:shhh')
    })

    it('should mix env vars and vault references', async () => {
      const result = await interpolateString('${REGION}-${vault:secret/data/db#password}', env, undefined, vault)
      expect(result).toBe('us-east-1-dbpass')
    })

    it('should escape vault references with $$', async () => {
      expect(await interpolateString('$${vault:secret/data/db#password}', env)).toBe('${vault:secret/data/db#password}')
    })

    it('should throw when vault reference has no # separator', async () => {
      await expect(interpolateString('${vault:secret/data/db}', env, undefined, vault)).rejects.toThrow(
        'expected format ${vault:path#field}',
      )
    })

    it('should throw when vault reference has empty path', async () => {
      await expect(interpolateString('${vault:#field}', env, undefined, vault)).rejects.toThrow(
        'path and field must not be empty',
      )
    })

    it('should throw when vault reference has empty field', async () => {
      await expect(interpolateString('${vault:secret/data/db#}', env, undefined, vault)).rejects.toThrow(
        'path and field must not be empty',
      )
    })

    it('should throw when no vault client is provided', async () => {
      await expect(interpolateString('${vault:secret/data/db#password}', env)).rejects.toThrow(
        'no vault configuration provided',
      )
    })

    it('should include context in vault errors', async () => {
      await expect(interpolateString('${vault:secret/data/missing#key}', env, 'workspace dev', vault)).rejects.toThrow(
        '(in workspace dev)',
      )
    })

    it('should include context when no vault client', async () => {
      await expect(interpolateString('${vault:secret/data/db#p}', env, 'root vars')).rejects.toThrow('(in root vars)')
    })
  })
})

describe('interpolateConfig', () => {
  const env = { BUCKET: 'my-bucket', KEY: 'state.tfstate', REGION: 'us-east-1' }

  it('should interpolate a plain string', async () => {
    expect(await interpolateConfig('${BUCKET}', env)).toBe('my-bucket')
  })

  it('should interpolate values in a record', async () => {
    const input = { bucket: '${BUCKET}', key: '${KEY}' }
    expect(await interpolateConfig(input, env)).toEqual({ bucket: 'my-bucket', key: 'state.tfstate' })
  })

  it('should interpolate strings in an array', async () => {
    const input = ['./envs/${REGION}.tfvars', 'static.tfvars']
    expect(await interpolateConfig(input, env)).toEqual(['./envs/us-east-1.tfvars', 'static.tfvars'])
  })

  it('should pass through non-string values unchanged', async () => {
    expect(await interpolateConfig(42, env)).toBe(42)
    expect(await interpolateConfig(true, env)).toBe(true)
    expect(await interpolateConfig(null, env)).toBeNull()
    expect(await interpolateConfig(undefined, env)).toBeUndefined()
  })

  it('should recursively interpolate nested objects', async () => {
    const input = {
      backend: { bucket: '${BUCKET}', key: '${KEY}' },
      vars: { region: '${REGION}' },
    }
    expect(await interpolateConfig(input, env)).toEqual({
      backend: { bucket: 'my-bucket', key: 'state.tfstate' },
      vars: { region: 'us-east-1' },
    })
  })

  it('should propagate context in errors', async () => {
    await expect(interpolateConfig('${MISSING}', env, 'test context')).rejects.toThrow(
      "Environment variable 'MISSING' is not set (in test context)",
    )
  })

  describe('vault references in config', () => {
    const vault = mockVaultClient({
      'secret/data/aws': { access_key: 'AKIA', secret_key: 'secret' },
    })

    it('should resolve vault references in nested objects', async () => {
      const input = {
        backend_config: {
          access_key: '${vault:secret/data/aws#access_key}',
          secret_key: '${vault:secret/data/aws#secret_key}',
        },
      }
      expect(await interpolateConfig(input, env, undefined, vault)).toEqual({
        backend_config: { access_key: 'AKIA', secret_key: 'secret' },
      })
    })

    it('should resolve vault references in arrays', async () => {
      const input = ['${vault:secret/data/aws#access_key}', 'static']
      expect(await interpolateConfig(input, env, undefined, vault)).toEqual(['AKIA', 'static'])
    })
  })
})
